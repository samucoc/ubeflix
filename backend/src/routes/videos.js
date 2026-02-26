const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { spawn, execFile } = require('child_process');
const mime = require('mime-types');
const { pool } = require('../config/db');

const router = express.Router();

const BROWSER_NATIVE_EXTENSIONS = new Set(['.mp4', '.webm', '.ogg', '.ogv']);
const BROWSER_NATIVE_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1']);
const BROWSER_NATIVE_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);

// Async codec detection with ffprobe
function probeCodec(filePath, streamType) {
  return new Promise((resolve) => {
    execFile('ffprobe', [
      '-v', 'error', '-select_streams', `${streamType}:0`,
      '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', filePath
    ], { timeout: 10000 }, (err, stdout) => {
      resolve(err ? 'unknown' : stdout.toString().trim().toLowerCase());
    });
  });
}

async function getCodecs(filePath) {
  const [video, audio] = await Promise.all([
    probeCodec(filePath, 'v'),
    probeCodec(filePath, 'a'),
  ]);
  return { video, audio };
}

function computeNeedsTranscoding(filePath, videoCodec, audioCodec) {
  const ext = path.extname(filePath).toLowerCase();
  return !BROWSER_NATIVE_EXTENSIONS.has(ext) ||
         !BROWSER_NATIVE_VIDEO_CODECS.has(videoCodec) ||
         !BROWSER_NATIVE_AUDIO_CODECS.has(audioCodec);
}

// Cache codec info in DB for instant access on subsequent requests
async function getOrCacheCodecs(videoId, filePath) {
  try {
    const cached = await pool.query(
      'SELECT video_codec, audio_codec, needs_transcoding FROM videos WHERE id = $1', [videoId]
    );
    const row = cached.rows[0];
    if (row && row.video_codec && row.audio_codec && row.needs_transcoding !== null) {
      return { video: row.video_codec, audio: row.audio_codec, needsTranscoding: row.needs_transcoding };
    }
  } catch {
    // Columns may not exist yet — fall through to probe
  }
  // Probe and persist
  const codecs = await getCodecs(filePath);
  const needsTranscoding = computeNeedsTranscoding(filePath, codecs.video, codecs.audio);
  pool.query(
    'UPDATE videos SET video_codec = $1, audio_codec = $2, needs_transcoding = $3 WHERE id = $4',
    [codecs.video, codecs.audio, needsTranscoding, videoId]
  ).catch(() => {});
  return { video: codecs.video, audio: codecs.audio, needsTranscoding };
}

// Helper: validate integer ID param
function parseId(val) {
  const n = parseInt(val, 10);
  return isNaN(n) || n < 1 ? null : n;
}

// ===== HLS Transcoding Management =====
const HLS_BASE_DIR = '/tmp/ubeflix-hls';
const hlsSessions = new Map();

// Cleanup old HLS sessions on startup
try {
  if (fs.existsSync(HLS_BASE_DIR)) fs.rmSync(HLS_BASE_DIR, { recursive: true, force: true });
  fs.mkdirSync(HLS_BASE_DIR, { recursive: true });
} catch (err) {
  console.error('Failed to init HLS directory:', err.message);
}

async function startHLSSession(videoId, filePath) {
  const id = String(videoId);
  const existing = hlsSessions.get(id);
  if (existing && !existing.finished) return existing;

  const dir = path.join(HLS_BASE_DIR, id);
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  } catch {}

  const { video: videoCodec, audio: audioCodec } = await getOrCacheCodecs(videoId, filePath);
  const isNativeVideo = BROWSER_NATIVE_VIDEO_CODECS.has(videoCodec);
  const isNativeAudio = BROWSER_NATIVE_AUDIO_CODECS.has(audioCodec);

  const videoArgs = isNativeVideo
    ? ['-c:v', 'copy']
    : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1'];
  const audioArgs = isNativeAudio
    ? ['-c:a', 'copy']
    : ['-c:a', 'aac', '-ac', '2', '-b:a', '128k'];

  const playlistPath = path.join(dir, 'index.m3u8');
  const segmentPattern = path.join(dir, 'seg_%05d.ts');

  console.log(`\uD83C\uDFA5 HLS transcode: ${path.basename(filePath)} [v:${videoCodec} a:${audioCodec}]`);

  const ffmpegArgs = [
    '-i', filePath,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-sn',
    ...videoArgs,
    ...audioArgs,
    '-f', 'hls',
    '-hls_time', '4',
    '-hls_list_size', '0',
    '-hls_playlist_type', 'event',
    '-hls_segment_filename', segmentPattern,
    '-start_number', '0',
    '-y',
    playlistPath,
  ];

  const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const session = {
    ffmpeg,
    dir,
    playlistPath,
    ready: false,
    finished: false,
    error: null,
    cleanupTimer: null,
  };

  let stderrOutput = '';

  ffmpeg.stderr.on('data', (data) => {
    stderrOutput += data.toString();
    if (!session.ready) {
      // Check if at least the first segment file physically exists
      const seg0 = path.join(dir, 'seg_00000.ts');
      if (fs.existsSync(seg0)) {
        try {
          const stat = fs.statSync(seg0);
          if (stat.size > 0) {
            session.ready = true;
            console.log(`\u2705 HLS ready for video ${id} (seg_00000.ts: ${stat.size} bytes)`);
          }
        } catch {}
      }
    }
  });

  ffmpeg.on('close', (code) => {
    session.finished = true;
    if (code !== 0 && code !== 255) {
      console.error(`\u274C HLS FFmpeg exited with code ${code} for video ${id}`);
      const lines = stderrOutput.split('\n').slice(-5).join('\n');
      console.error('FFmpeg stderr:', lines);
      session.error = `FFmpeg exited with code ${code}`;
    } else {
      console.log(`\u2705 HLS transcode completed for video ${id}`);
    }
    // Cleanup after 30 minutes
    session.cleanupTimer = setTimeout(() => {
      cleanupHLSSession(id);
    }, 30 * 60 * 1000);
  });

  ffmpeg.on('error', (err) => {
    session.error = err.message;
    session.finished = true;
    console.error(`\u274C HLS FFmpeg error for video ${id}:`, err.message);
  });

  hlsSessions.set(id, session);
  return session;
}

function cleanupHLSSession(videoId) {
  const id = String(videoId);
  const session = hlsSessions.get(id);
  if (session) {
    if (session.ffmpeg && !session.finished) {
      session.ffmpeg.kill('SIGTERM');
    }
    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
    }
    try {
      if (fs.existsSync(session.dir)) {
        fs.rmSync(session.dir, { recursive: true, force: true });
      }
    } catch {}
    hlsSessions.delete(id);
    console.log(`\uD83E\uDDF9 Cleaned up HLS for video ${id}`);
  }
}

// GET /api/videos - List all videos (movies)
router.get('/', async (req, res) => {
  try {
    const { type, search, library_id, limit, offset } = req.query;

    let query = `
      SELECT v.*, l.name as library_name 
      FROM videos v 
      LEFT JOIN libraries l ON v.library_id = l.id 
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (type) {
      query += ` AND v.video_type = $${paramIndex++}`;
      params.push(type);
    }

    if (search) {
      query += ` AND v.title ILIKE $${paramIndex++}`;
      params.push(`%${search}%`);
    }

    if (library_id) {
      query += ` AND v.library_id = $${paramIndex++}`;
      params.push(library_id);
    }

    query += ' ORDER BY v.title ASC';

    if (limit) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(parseInt(limit));
    }

    if (offset) {
      query += ` OFFSET $${paramIndex++}`;
      params.push(parseInt(offset));
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get videos error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/videos/recent
router.get('/recent', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.*, l.name as library_name 
      FROM videos v 
      LEFT JOIN libraries l ON v.library_id = l.id 
      ORDER BY v.created_at DESC 
      LIMIT 20
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Get recent videos error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/videos/series - List all series (MUST be before /:id to avoid route conflict)
router.get('/series/list', async (req, res) => {
  try {
    const { library_id, search } = req.query;

    let query = `
      SELECT s.*, l.name as library_name,
        (SELECT COUNT(*) FROM videos WHERE series_id = s.id) as episode_count,
        (SELECT COUNT(DISTINCT season_id) FROM videos WHERE series_id = s.id) as season_count
      FROM series s
      LEFT JOIN libraries l ON s.library_id = l.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (library_id) {
      query += ` AND s.library_id = $${paramIndex++}`;
      params.push(library_id);
    }

    if (search) {
      query += ` AND s.title ILIKE $${paramIndex++}`;
      params.push(`%${search}%`);
    }

    query += ' ORDER BY s.title ASC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get series error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/videos/series/:id
router.get('/series/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const seriesResult = await pool.query('SELECT * FROM series WHERE id = $1', [id]);
    if (seriesResult.rows.length === 0) {
      return res.status(404).json({ error: 'Serie no encontrada' });
    }

    const seasonsResult = await pool.query(
      'SELECT * FROM seasons WHERE series_id = $1 ORDER BY season_number',
      [id]
    );

    const episodesResult = await pool.query(
      'SELECT * FROM videos WHERE series_id = $1 ORDER BY season_id, episode_number',
      [id]
    );

    const series = seriesResult.rows[0];
    series.seasons = seasonsResult.rows.map(season => ({
      ...season,
      episodes: episodesResult.rows.filter(ep => ep.season_id === season.id),
    }));

    res.json(series);
  } catch (err) {
    console.error('Get series detail error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/videos/:id
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT v.*, l.name as library_name, l.path as library_path,
             s.title as series_title,
             se.season_number
      FROM videos v
      LEFT JOIN libraries l ON v.library_id = l.id
      LEFT JOIN series s ON v.series_id = s.id
      LEFT JOIN seasons se ON v.season_id = se.id
      WHERE v.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Video no encontrado' });
    }

    const videoData = result.rows[0];
    // Use cached value if available, otherwise async probe + persist
    if (videoData.needs_transcoding !== null && videoData.needs_transcoding !== undefined) {
      // Already cached in DB — instant response
    } else if (videoData.file_path) {
      try {
        await fsp.access(videoData.file_path);
        const { needsTranscoding } = await getOrCacheCodecs(videoData.id, videoData.file_path);
        videoData.needs_transcoding = needsTranscoding;
      } catch {
        videoData.needs_transcoding = false;
      }
    } else {
      videoData.needs_transcoding = false;
    }

    res.json(videoData);
  } catch (err) {
    console.error('Get video error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/videos/:id/stream
router.get('/:id/stream', async (req, res) => {
  try {
    const { id } = req.params;
    let result;
    try {
      result = await pool.query('SELECT file_path, video_codec, audio_codec, needs_transcoding FROM videos WHERE id = $1', [id]);
    } catch {
      // Fallback if codec columns don't exist
      result = await pool.query('SELECT file_path FROM videos WHERE id = $1', [id]);
    }

    if (result.rows.length === 0) return res.status(404).json({ error: 'Video no encontrado' });

    const { file_path: filePath, needs_transcoding: cachedTranscoding } = result.rows[0];

    try { await fsp.access(filePath); } catch {
      return res.status(404).json({ error: 'Archivo de video no encontrado en disco' });
    }

    // Use cached transcoding flag if available
    let needsTranscoding = cachedTranscoding;
    if (needsTranscoding === null || needsTranscoding === undefined) {
      const { needsTranscoding: nt } = await getOrCacheCodecs(id, filePath);
      needsTranscoding = nt;
    }

    if (needsTranscoding) {
      return res.status(415).json({
        error: 'Este video necesita transcodificación. Use el endpoint HLS.',
        needs_transcoding: true,
        hls_url: `/api/videos/${id}/hls/index.m3u8`,
      });
    }

    const stat = await fsp.stat(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    const mimeType = mime.lookup(filePath) || 'video/mp4';

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=3600',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    console.error('Stream error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Error al transmitir video' });
  }
});

// GET /api/videos/:id/hls/index.m3u8 - Start HLS transcoding and serve playlist
router.get('/:id/hls/index.m3u8', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT file_path FROM videos WHERE id = $1', [id]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Video no encontrado' });

    const filePath = result.rows[0].file_path;
    try { await fsp.access(filePath); } catch {
      return res.status(404).json({ error: 'Archivo no encontrado en disco' });
    }

    const session = await startHLSSession(id, filePath);

    if (session.error) {
      return res.status(500).json({ error: 'Error en transcoding: ' + session.error });
    }

    // Wait for playlist to be ready (max 30s)
    const maxWait = 30000;
    const startTime = Date.now();
    while (!session.ready && !session.error && (Date.now() - startTime) < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (session.error) {
      return res.status(500).json({ error: 'Error en transcoding' });
    }

    if (!session.ready) {
      return res.status(503).json({ error: 'Transcoding en progreso, intente de nuevo' });
    }

    // Serve the current playlist
    let playlist = await fsp.readFile(session.playlistPath, 'utf8');
    // If transcoding finished, ensure #EXT-X-ENDLIST is present
    if (session.finished && !playlist.includes('#EXT-X-ENDLIST')) {
      playlist += '\n#EXT-X-ENDLIST\n';
    }
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(playlist);
  } catch (err) {
    console.error('HLS playlist error:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/videos/:id/hls/:filename - Serve HLS segments
router.get('/:id/hls/:filename', async (req, res) => {
  const { id, filename } = req.params;
  const session = hlsSessions.get(String(id));

  if (!session) return res.status(404).json({ error: 'Sesión HLS no encontrada' });
  if (!filename.endsWith('.ts') && !filename.endsWith('.m3u8')) {
    return res.status(400).json({ error: 'Tipo de archivo no permitido' });
  }

  const segmentPath = path.join(session.dir, filename);
  try { await fsp.access(segmentPath); } catch {
    return res.status(404).json({ error: 'Segmento no encontrado' });
  }

  if (filename.endsWith('.m3u8')) {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store');
  } else {
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Cache-Control', 'public, max-age=86400');
  }

  const stat = await fsp.stat(segmentPath);
  res.setHeader('Content-Length', stat.size);
  fs.createReadStream(segmentPath).pipe(res);
});

// POST /api/videos/:id/progress
router.post('/:id/progress', async (req, res) => {
  try {
    const { id } = req.params;
    const { progress_seconds, completed } = req.body;
    const userId = req.user.id;

    await pool.query(`
      INSERT INTO watch_progress (user_id, video_id, progress_seconds, completed, last_watched_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, video_id)
      DO UPDATE SET progress_seconds = $3, completed = $4, last_watched_at = CURRENT_TIMESTAMP
    `, [userId, id, progress_seconds || 0, completed || false]);

    res.json({ message: 'Progreso guardado' });
  } catch (err) {
    console.error('Save progress error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/videos/:id/progress
router.get('/:id/progress', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await pool.query(
      'SELECT * FROM watch_progress WHERE user_id = $1 AND video_id = $2',
      [userId, id]
    );

    res.json(result.rows[0] || { progress_seconds: 0, completed: false });
  } catch (err) {
    console.error('Get progress error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;

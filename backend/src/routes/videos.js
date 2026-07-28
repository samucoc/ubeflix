const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { spawn, execFile } = require('child_process');
const mime = require('mime-types');
const { pool } = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const { streamFileWithRange } = require('../utils/streamFile');

const { asyncHandler } = require('../utils/asyncHandler');
const { getPagination, setPaginationHeaders } = require('../utils/pagination');

const { requireNumericParams } = require('../utils/params');

const router = express.Router();

// Los ids de ruta van directo a la base: validarlos acá evita un 500 por `/api/x/abc`.
requireNumericParams(router, 'id', 'videoId');

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

// Probe all audio tracks from a video file
// Probe video resolution (width x height) from source file
function probeResolution(filePath) {
  return new Promise((resolve) => {
    execFile('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json', filePath,
    ], { timeout: 10000 }, (err, stdout) => {
      if (err) return resolve({ width: 1920, height: 1080 });
      try {
        const data = JSON.parse(stdout);
        const s = data.streams?.[0];
        resolve({ width: s?.width || 1920, height: s?.height || 1080 });
      } catch {
        resolve({ width: 1920, height: 1080 });
      }
    });
  });
}

// Probe all audio tracks from a video file
function probeAudioTracks(filePath) {
  return new Promise((resolve) => {
    execFile('ffprobe', [
      '-v', 'error', '-select_streams', 'a',
      '-show_entries', 'stream=index,codec_name,channels,channel_layout,bit_rate:stream_tags=language,title,handler_name',
      '-of', 'json', filePath
    ], { timeout: 15000 }, (err, stdout) => {
      if (err) return resolve([]);
      try {
        const data = JSON.parse(stdout);
        const streams = data.streams || [];
        return resolve(streams.map((s, i) => {
          const tags = s.tags || {};
          const label = tags.title || tags.handler_name || '';
          const lang = tags.language || 'und';
          return {
            index: i,
            streamIndex: s.index,
            codec: s.codec_name,
            channels: s.channels,
            channelLayout: s.channel_layout || '',
            bitRate: s.bit_rate ? parseInt(s.bit_rate) : null,
            language: lang,
            label: label || (lang !== 'und' ? lang.toUpperCase() : `Audio ${i + 1}`),
          };
        }));
      } catch {
        return resolve([]);
      }
    });
  });
}

// Helper: validate integer ID param
function parseId(val) {
  const n = parseInt(val, 10);
  return isNaN(n) || n < 1 ? null : n;
}

// ===== HLS Transcoding Management =====
const HLS_BASE_DIR = '/tmp/ubeflix-hls';
const hlsSessions = new Map();
const HLS_CACHE_TTL_MS = parseInt(process.env.HLS_CACHE_TTL_MS || String(45 * 60 * 1000), 10);
const HLS_CLEANUP_INTERVAL_MS = parseInt(process.env.HLS_CLEANUP_INTERVAL_MS || String(10 * 60 * 1000), 10);
const HLS_CACHE_MAX_BYTES = parseInt(process.env.HLS_CACHE_MAX_BYTES || String(20 * 1024 * 1024 * 1024), 10);
const HLS_EVICTION_LOG_MAX = parseInt(process.env.HLS_EVICTION_LOG_MAX || '100', 10);
const STDERR_TAIL_CHARS = 8000;
const hlsEvictions = [];

// ABR rendition ladder: name, target height, video/audio bitrates, HLS BANDWIDTH hint
const RENDITIONS = [
  { name: '480p',  height: 480,  videoBitrate: '1500k', audioBitrate: '128k', bandwidth: 1628000 },
  { name: '720p',  height: 720,  videoBitrate: '3000k', audioBitrate: '192k', bandwidth: 3192000 },
  { name: '1080p', height: 1080, videoBitrate: '6000k', audioBitrate: '192k', bandwidth: 6192000 },
];

function parseAudioTrackIndex(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function buildSessionKey(videoId, audioTrackIndex) {
  return `${String(videoId)}::a${audioTrackIndex}`;
}

function getSessionDir(videoId, audioTrackIndex) {
  return path.join(HLS_BASE_DIR, String(videoId), `a${audioTrackIndex}`);
}

// Everything below walks a cache directory that holds up to HLS_CACHE_MAX_BYTES
// (20 GB by default) of segments. Doing that synchronously — on a timer and on
// every stats request — stalls the event loop for the whole server, so all of
// it is async.

// Fire-and-forget: the mtime is only an LRU hint, a failed touch is harmless.
function touchDir(dirPath) {
  const now = new Date();
  fsp.utimes(dirPath, now, now).catch(() => {});
}

async function isPathFresh(p) {
  try {
    const st = await fsp.stat(p);
    return (Date.now() - st.mtimeMs) <= HLS_CACHE_TTL_MS;
  } catch {
    return false;
  }
}

async function statMtimeMs(p) {
  try {
    return (await fsp.stat(p)).mtimeMs;
  } catch {
    return 0;
  }
}

async function pathExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function listSubdirectories(dirPath) {
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    return entries.filter((d) => d.isDirectory());
  } catch {
    return [];
  }
}

async function getDirectorySizeBytes(dirPath) {
  let entries;
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }

  // Siblings in parallel: the walk is dominated by stat latency, not CPU.
  const sizes = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) return getDirectorySizeBytes(fullPath);
    if (!entry.isFile()) return 0;
    try {
      return (await fsp.stat(fullPath)).size;
    } catch {
      return 0;
    }
  }));

  return sizes.reduce((total, size) => total + size, 0);
}

function getTrackedSessionKeyByDir(dirPath) {
  for (const [key, session] of hlsSessions.entries()) {
    if (session.dir === dirPath) return key;
  }
  return null;
}

function logEviction({ reason, sessionKey, dir, sizeBytes }) {
  hlsEvictions.push({
    ts: new Date().toISOString(),
    reason,
    sessionKey: sessionKey || null,
    dir,
    sizeBytes,
  });
  if (hlsEvictions.length > HLS_EVICTION_LOG_MAX) {
    hlsEvictions.splice(0, hlsEvictions.length - HLS_EVICTION_LOG_MAX);
  }
}

async function removeCacheDir(dirPath, reason = 'manual', sessionKey = null) {
  const sizeBytes = await getDirectorySizeBytes(dirPath);
  try {
    await fsp.rm(dirPath, { recursive: true, force: true });
  } catch {}
  if (sizeBytes > 0 || sessionKey) {
    logEviction({ reason, sessionKey, dir: dirPath, sizeBytes });
  }
  return sizeBytes;
}

async function collectCacheSessionEntries() {
  const videoDirs = await listSubdirectories(HLS_BASE_DIR);

  const perVideo = await Promise.all(videoDirs.map(async (vd) => {
    const vdPath = path.join(HLS_BASE_DIR, vd.name);
    const trackDirs = await listSubdirectories(vdPath);

    return Promise.all(trackDirs.map(async (td) => {
      const dir = path.join(vdPath, td.name);
      const [mtimeMs, sizeBytes] = await Promise.all([
        statMtimeMs(dir),
        getDirectorySizeBytes(dir),
      ]);
      const audioTrack = parseAudioTrackIndex(td.name.replace(/^a/i, ''));
      const sessionKey = buildSessionKey(vd.name, audioTrack);
      const inMemorySession = hlsSessions.get(sessionKey) || null;
      const activeTranscode = !!(inMemorySession && Array.isArray(inMemorySession.renditions) && inMemorySession.renditions.some((r) => r.ffmpeg && !r.finished));
      return {
        sessionKey,
        videoId: vd.name,
        audioTrack,
        dir,
        sizeBytes,
        mtimeMs,
        lastUsedAt: mtimeMs ? new Date(mtimeMs).toISOString() : null,
        inMemory: !!inMemorySession,
        activeTranscode,
      };
    }));
  }));

  return perVideo.flat();
}

async function attachCachedSessionFromDisk(videoId, audioTrackIndex) {
  const key = buildSessionKey(videoId, audioTrackIndex);
  const dir = getSessionDir(videoId, audioTrackIndex);
  const playlistPath = path.join(dir, 'index.m3u8');

  const [exists, fresh] = await Promise.all([pathExists(playlistPath), isPathFresh(dir)]);
  if (!exists || !fresh) return null;

  const session = {
    key,
    videoId: String(videoId),
    audioTrackIndex,
    dir,
    playlistPath,
    isMaster: true,
    ready: true,
    finished: true,
    error: null,
    renditions: [],
    finishedCount: 0,
  };

  hlsSessions.set(key, session);
  touchDir(dir);
  return session;
}

async function cleanupHLSSession(sessionKey, reason = 'manual') {
  const session = hlsSessions.get(sessionKey);
  if (!session) return;

  for (const r of (session.renditions || [])) {
    if (r.ffmpeg && !r.finished) {
      try { r.ffmpeg.kill('SIGTERM'); } catch {}
    }
  }

  // Drop it from the map before the (async) delete so no request can attach to
  // a session whose files are being removed.
  hlsSessions.delete(sessionKey);
  await removeCacheDir(session.dir, reason, sessionKey);
  console.log(`HLS cache cleaned: ${sessionKey} (${reason})`);
}

async function invalidateHLSSession(videoId, audioTrackIndex, reason = 'manual') {
  const vId = String(videoId);
  const track = parseAudioTrackIndex(audioTrackIndex);
  const sessionKey = buildSessionKey(vId, track);

  if (hlsSessions.has(sessionKey)) {
    await cleanupHLSSession(sessionKey, reason);
    return { sessionKey, removed: true, source: 'memory+disk' };
  }

  const dir = getSessionDir(vId, track);
  if (await pathExists(dir)) {
    await removeCacheDir(dir, reason, sessionKey);
    return { sessionKey, removed: true, source: 'disk' };
  }

  return { sessionKey, removed: false, source: 'none' };
}

let cleanupRunning = false;

async function cleanupExpiredHLSCache() {
  // The interval keeps firing even if a sweep is slow; don't stack them.
  if (cleanupRunning) return;
  cleanupRunning = true;

  try {
    const cutoff = Date.now() - HLS_CACHE_TTL_MS;

    // Clean tracked sessions first.
    for (const [key, session] of [...hlsSessions.entries()]) {
      const mtimeMs = await statMtimeMs(session.dir);
      if (!mtimeMs || mtimeMs < cutoff) {
        await cleanupHLSSession(key, 'ttl');
      }
    }

    // Walk every cache directory on disk (tracked and orphan alike), measuring
    // each one once and reusing that measurement for the LRU pass below.
    const videoDirs = await listSubdirectories(HLS_BASE_DIR);
    const measured = [];

    for (const vd of videoDirs) {
      const vdPath = path.join(HLS_BASE_DIR, vd.name);
      const trackDirs = await listSubdirectories(vdPath);
      for (const td of trackDirs) {
        const dir = path.join(vdPath, td.name);
        const mtimeMs = await statMtimeMs(dir);

        if (!mtimeMs || mtimeMs < cutoff) {
          const trackedKey = getTrackedSessionKeyByDir(dir);
          if (trackedKey) await cleanupHLSSession(trackedKey, 'ttl');
          else await removeCacheDir(dir, 'ttl-orphan');
          continue; // already gone — nothing left to weigh
        }

        measured.push({ dir, mtimeMs, sizeBytes: await getDirectorySizeBytes(dir) });
      }
    }

    // LRU eviction by total cache size (mtime is the last-used signal touchDir keeps fresh).
    if (HLS_CACHE_MAX_BYTES > 0) {
      let totalSize = measured.reduce((acc, e) => acc + e.sizeBytes, 0);
      if (totalSize > HLS_CACHE_MAX_BYTES) {
        measured.sort((a, b) => a.mtimeMs - b.mtimeMs);
        for (const entry of measured) {
          if (totalSize <= HLS_CACHE_MAX_BYTES) break;
          const trackedKey = getTrackedSessionKeyByDir(entry.dir);
          if (trackedKey) await cleanupHLSSession(trackedKey, 'lru');
          else await removeCacheDir(entry.dir, 'lru-orphan');
          totalSize -= entry.sizeBytes;
        }
      }
    }
  } catch (err) {
    console.warn('HLS cleanup warning:', err.message);
  } finally {
    cleanupRunning = false;
  }
}

// Keep cache directory on startup for reuse across container restarts.
try {
  fs.mkdirSync(HLS_BASE_DIR, { recursive: true });
} catch (err) {
  console.error('Failed to init HLS directory:', err.message);
}

setInterval(() => {
  cleanupExpiredHLSCache().catch((err) => console.warn('HLS cleanup error:', err.message));
}, HLS_CLEANUP_INTERVAL_MS).unref();

// Session starts that are still in flight, keyed like hlsSessions.
// createHLSSession awaits ffprobe before registering the session, so without
// this two concurrent requests for the same video (the /:id prewarm and the
// player's own request, which is the normal case) would each spawn a full set
// of ffmpeg processes writing into the same directory.
const hlsPending = new Map();

function startHLSSession(videoId, filePath, audioTrackIndex = 0) {
  const id = String(videoId);
  const track = parseAudioTrackIndex(audioTrackIndex);
  const key = buildSessionKey(id, track);

  const existing = hlsSessions.get(key);
  if (existing && !existing.error) {
    touchDir(existing.dir);
    return Promise.resolve(existing);
  }

  const inFlight = hlsPending.get(key);
  if (inFlight) return inFlight;

  // Registered synchronously — no await may run before this line.
  const started = createHLSSession(id, filePath, track, key)
    .finally(() => { hlsPending.delete(key); });
  hlsPending.set(key, started);
  return started;
}

async function createHLSSession(id, filePath, track, key) {
  // Reuse a still-fresh transcode from a previous run before doing any work.
  const hydrated = await attachCachedSessionFromDisk(id, track);
  if (hydrated) return hydrated;

  const dir = getSessionDir(id, track);
  try { await fsp.mkdir(dir, { recursive: true }); } catch {}

  const { video: videoCodec, audio: audioCodec } = await getOrCacheCodecs(id, filePath);
  const isNativeAudio = BROWSER_NATIVE_AUDIO_CODECS.has(audioCodec);

  // Probe source resolution to build an appropriate rendition ladder
  const { height: srcHeight } = await probeResolution(filePath);
  const applicable = RENDITIONS.filter(r => r.height <= srcHeight + 100);
  const renditions = applicable.length > 0 ? applicable : [RENDITIONS[0]];

  // Write master HLS playlist immediately — static, just references sub-playlists
  const playlistPath = path.join(dir, 'index.m3u8');
  let master = '#EXTM3U\n#EXT-X-VERSION:3\n';
  for (const r of renditions) {
    const width = Math.round(r.height * 16 / 9);
    master += `#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},RESOLUTION=${width}x${r.height},CODECS="avc1.4d401f,mp4a.40.2"\n`;
    master += `${r.name}/index.m3u8\n`;
  }
  await fsp.writeFile(playlistPath, master);

  const session = {
    key,
    videoId: id,
    dir,
    playlistPath,
    isMaster: true,
    ready: false,
    finished: false,
    error: null,
    audioTrackIndex: track,
    renditions: renditions.map(r => ({ ...r, ffmpeg: null, finished: false, error: null })),
    finishedCount: 0,
  };

  // Start one ffmpeg process per rendition (they run in parallel)
  for (let i = 0; i < renditions.length; i++) {
    const r = renditions[i];
    const rDir = path.join(dir, r.name);
    try { await fsp.mkdir(rDir, { recursive: true }); } catch {}
    const rPlaylistPath = path.join(rDir, 'index.m3u8');
    const rSegmentPattern = path.join(rDir, 'seg_%05d.ts');

    // If same resolution as source we can copy the video stream; otherwise must re-encode to scale
    const mustScale = r.height !== srcHeight;
    const videoArgs = mustScale
      ? [
          '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
          '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1',
          '-vf', `scale=-2:${r.height}`,
          '-b:v', r.videoBitrate, '-maxrate', r.videoBitrate,
          '-bufsize', `${parseInt(r.videoBitrate) * 2}k`,
        ]
      : ['-c:v', 'copy'];
    const audioArgs = isNativeAudio
      ? ['-c:a', 'copy']
      : ['-c:a', 'aac', '-ac', '2', '-b:a', r.audioBitrate];

    const ffmpegArgs = [
      '-i', filePath,
      '-map', '0:v:0',
      '-map', `0:a:${track}?`,
      '-sn',
      ...videoArgs,
      ...audioArgs,
      '-f', 'hls',
      '-hls_time', '4',
      '-hls_list_size', '0',
      '-hls_playlist_type', 'event',
      '-hls_segment_filename', rSegmentPattern,
      '-start_number', '0',
      '-y',
      rPlaylistPath,
    ];

    console.log(`🎥 HLS [${r.name}] start: ${path.basename(filePath)} [v:${videoCodec} a:${audioCodec}]`);
    const ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    const rState = session.renditions[i];
    rState.ffmpeg = ffmpeg;

    // Only the tail is ever read (last 5 lines on failure); ffmpeg emits stderr
    // continuously for the whole file, so keeping all of it grows unbounded.
    let stderrOutput = '';
    const firstSegment = path.join(rDir, 'seg_00000.ts');
    let readyCheckInFlight = false;

    ffmpeg.stderr.on('data', (data) => {
      stderrOutput = (stderrOutput + data.toString()).slice(-STDERR_TAIL_CHARS);

      // Mark session ready when the LOWEST quality rendition has its first segment.
      // This handler fires many times per second, so the check is async and never
      // overlaps itself.
      if (session.ready || i !== 0 || readyCheckInFlight) return;
      readyCheckInFlight = true;
      fsp.stat(firstSegment)
        .then((st) => {
          if (st.size > 0 && !session.ready) {
            session.ready = true;
            console.log(`✅ HLS ready for video ${id} (${r.name}, first segment)`);
          }
        })
        .catch(() => {})
        .finally(() => { readyCheckInFlight = false; });
    });

    ffmpeg.on('close', (code) => {
      rState.finished = true;
      session.finishedCount++;
      if (code !== 0 && code !== 255) {
        rState.error = `FFmpeg exited ${code}`;
        if (!session.error) session.error = rState.error;
        console.error(`❌ HLS [${r.name}] error for video ${id}: code ${code}`);
        console.error('FFmpeg stderr:', stderrOutput.split('\n').slice(-5).join('\n'));
      } else {
        console.log(`✅ HLS [${r.name}] done for video ${id}`);
      }
      if (session.finishedCount >= session.renditions.length) {
        session.finished = true;
        touchDir(session.dir);
      }
    });

    ffmpeg.on('error', (err) => {
      rState.error = err.message;
      rState.finished = true;
      if (!session.error) session.error = err.message;
      console.error(`❌ HLS [${r.name}] spawn error for video ${id}:`, err.message);
    });
  }

  hlsSessions.set(key, session);
  touchDir(session.dir);
  return session;
}

function prewarmHLSSession(videoId, filePath, audioTrackIndex = 0) {
  // Fire-and-forget warmup: if a compatible session already exists this is a no-op.
  const track = parseAudioTrackIndex(audioTrackIndex);
  startHLSSession(videoId, filePath, track).catch((err) => {
    console.warn(`HLS prewarm failed for video ${videoId}:`, err.message);
  });
}

// GET /api/videos - List all videos (movies)
router.get('/', asyncHandler(async (req, res) => {
  const { type, search, library_id } = req.query;
  const { limit, offset } = getPagination(req.query);

  const conditions = [];
  const params = [];

  if (type) {
    params.push(type);
    conditions.push(`v.video_type = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`v.title ILIKE $${params.length}`);
  }
  if (library_id) {
    params.push(library_id);
    conditions.push(`v.library_id = $${params.length}`);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const [totalResult, result] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM videos v ${where}`, params),
    pool.query(
      `SELECT v.*, l.name as library_name
       FROM videos v
       LEFT JOIN libraries l ON v.library_id = l.id
       ${where}
       ORDER BY v.title ASC, v.id ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
  ]);

  setPaginationHeaders(res, { total: totalResult.rows[0].total, offset, count: result.rows.length });
  res.json(result.rows);
}));

// GET /api/videos/recent
router.get('/recent', asyncHandler(async (req, res) => {
  const result = await pool.query(`
    SELECT v.*, l.name as library_name 
    FROM videos v 
    LEFT JOIN libraries l ON v.library_id = l.id 
    ORDER BY v.created_at DESC 
    LIMIT 20
  `);
  res.json(result.rows);
}));

// GET /api/videos/series - List all series (MUST be before /:id to avoid route conflict)
router.get('/series/list', asyncHandler(async (req, res) => {
  const { library_id, search } = req.query;
  const { limit, offset } = getPagination(req.query);

  const conditions = [];
  const params = [];

  if (library_id) {
    params.push(library_id);
    conditions.push(`s.library_id = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`s.title ILIKE $${params.length}`);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const [totalResult, result] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM series s ${where}`, params),
    pool.query(
      `SELECT s.*, l.name as library_name,
        (SELECT COUNT(*) FROM videos WHERE series_id = s.id) as episode_count,
        (SELECT COUNT(DISTINCT season_id) FROM videos WHERE series_id = s.id) as season_count
       FROM series s
       LEFT JOIN libraries l ON s.library_id = l.id
       ${where}
       ORDER BY s.title ASC, s.id ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
  ]);

  setPaginationHeaders(res, { total: totalResult.rows[0].total, offset, count: result.rows.length });
  res.json(result.rows);
}));

// GET /api/videos/series/:id
router.get('/series/:id', asyncHandler(async (req, res) => {
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
    `SELECT v.* FROM videos v
     LEFT JOIN seasons se ON v.season_id = se.id
     WHERE v.series_id = $1
     ORDER BY se.season_number ASC, v.title ASC`,
    [id]
  );

  const series = seriesResult.rows[0];
  series.seasons = seasonsResult.rows.map(season => ({
    ...season,
    episodes: episodesResult.rows.filter(ep => ep.season_id === season.id),
  }));

  res.json(series);
}));

// GET /api/videos/hls-cache/stats - Admin stats for HLS cache usage and evictions
router.get('/hls-cache/stats', requireAdmin, asyncHandler(async (req, res) => {
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
  const entries = await collectCacheSessionEntries();
  const sorted = [...entries].sort((a, b) => b.mtimeMs - a.mtimeMs);

  const totalBytes = entries.reduce((acc, e) => acc + e.sizeBytes, 0);
  const activeTranscodes = entries.filter((e) => e.activeTranscode).length;
  const inMemorySessions = entries.filter((e) => e.inMemory).length;

  res.json({
    now: new Date().toISOString(),
    config: {
      cacheBaseDir: HLS_BASE_DIR,
      ttlMs: HLS_CACHE_TTL_MS,
      cleanupIntervalMs: HLS_CLEANUP_INTERVAL_MS,
      maxBytes: HLS_CACHE_MAX_BYTES,
    },
    totals: {
      bytes: totalBytes,
      sessionsOnDisk: entries.length,
      sessionsInMemory: inMemorySessions,
      activeTranscodes,
      usagePercent: HLS_CACHE_MAX_BYTES > 0 ? Number(((totalBytes / HLS_CACHE_MAX_BYTES) * 100).toFixed(2)) : null,
    },
    sessions: sorted.slice(0, limit),
    recentEvictions: [...hlsEvictions].reverse().slice(0, limit),
  });
}));

// POST /api/videos/hls-cache/cleanup - Force immediate cleanup (TTL + LRU)
router.post('/hls-cache/cleanup', requireAdmin, asyncHandler(async (req, res) => {
  const beforeEntries = await collectCacheSessionEntries();
  const beforeBytes = beforeEntries.reduce((acc, e) => acc + e.sizeBytes, 0);

  await cleanupExpiredHLSCache();

  const afterEntries = await collectCacheSessionEntries();
  const afterBytes = afterEntries.reduce((acc, e) => acc + e.sizeBytes, 0);

  res.json({
    message: 'Limpieza ejecutada',
    before: {
      sessionsOnDisk: beforeEntries.length,
      bytes: beforeBytes,
    },
    after: {
      sessionsOnDisk: afterEntries.length,
      bytes: afterBytes,
    },
    removed: {
      sessions: Math.max(0, beforeEntries.length - afterEntries.length),
      bytes: Math.max(0, beforeBytes - afterBytes),
    },
    recentEvictions: [...hlsEvictions].reverse().slice(0, 20),
  });
}));

// DELETE /api/videos/hls-cache/session/:videoId/:audioTrack - Invalidate a single cache session
router.delete('/hls-cache/session/:videoId/:audioTrack', requireAdmin, asyncHandler(async (req, res) => {
  const { videoId } = req.params;
  const audioTrack = parseAudioTrackIndex(req.params.audioTrack);

  if (!videoId || !String(videoId).trim()) {
    return res.status(400).json({ error: 'videoId requerido' });
  }

  const result = await invalidateHLSSession(videoId, audioTrack, 'manual-session');

  if (!result.removed) {
    return res.status(404).json({
      error: 'Sesión no encontrada',
      sessionKey: result.sessionKey,
    });
  }

  res.json({
    message: 'Sesión invalidada',
    sessionKey: result.sessionKey,
    source: result.source,
  });
}));

// GET /api/videos/:id
router.get('/:id', asyncHandler(async (req, res) => {
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

  // Prewarm HLS in background so first playback starts faster.
  if (videoData.needs_transcoding && videoData.file_path) {
    prewarmHLSSession(videoData.id, videoData.file_path, 0);
  }

  res.json(videoData);
}));

// GET /api/videos/:id/audio-tracks - List audio tracks in a video file
router.get('/:id/audio-tracks', asyncHandler(async (req, res) => {
  const videoId = parseId(req.params.id);
  if (!videoId) return res.status(400).json({ error: 'ID inválido' });

  const result = await pool.query('SELECT file_path FROM videos WHERE id = $1', [videoId]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Video no encontrado' });

  const filePath = result.rows[0].file_path;
  try { await fsp.access(filePath); } catch {
    return res.status(404).json({ error: 'Archivo no encontrado en disco' });
  }

  const tracks = await probeAudioTracks(filePath);
  res.json(tracks);
}));

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
      const audioTrack = parseAudioTrackIndex(req.query.audioTrack);
      prewarmHLSSession(id, filePath, audioTrack);
      return res.status(415).json({
        error: 'Este video necesita transcodificación. Use el endpoint HLS.',
        needs_transcoding: true,
        hls_url: `/api/videos/${id}/hls/index.m3u8?audioTrack=${audioTrack}`,
      });
    }

    const served = await streamFileWithRange(req, res, filePath, {
      contentType: mime.lookup(filePath) || 'video/mp4',
      cacheControl: 'public, max-age=3600',
    });
    if (!served) {
      return res.status(404).json({ error: 'Archivo de video no encontrado en disco' });
    }
  } catch (err) {
    console.error('Stream error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Error al transmitir video' });
  }
});

// GET /api/videos/:id/hls/index.m3u8 - Start HLS transcoding and serve playlist
router.get('/:id/hls/index.m3u8', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await pool.query('SELECT file_path FROM videos WHERE id = $1', [id]);

  if (result.rows.length === 0) return res.status(404).json({ error: 'Video no encontrado' });

  const filePath = result.rows[0].file_path;
  try { await fsp.access(filePath); } catch {
    return res.status(404).json({ error: 'Archivo no encontrado en disco' });
  }

  const audioTrack = parseAudioTrackIndex(req.query.audioTrack);
  const session = await startHLSSession(id, filePath, audioTrack);

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

  touchDir(session.dir);
  // Serve the master playlist (static — no #EXT-X-ENDLIST needed)
   const playlist = await fsp.readFile(session.playlistPath, 'utf8');
   res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(playlist);
}));

// GET /api/videos/:id/hls/* - Serve HLS segments and sub-playlists (multi-rendition)
router.get('/:id/hls/*', async (req, res) => {
  const { id } = req.params;
  const subPath = req.params[0] || '';
  const audioTrack = parseAudioTrackIndex(req.query.audioTrack);
  const key = buildSessionKey(id, audioTrack);
  const session = hlsSessions.get(key) || await attachCachedSessionFromDisk(id, audioTrack);

  if (!session) return res.status(404).json({ error: 'Sesión HLS no encontrada' });

  // Normalise and validate path — prevent directory traversal
  const normalized = path.normalize(subPath).replace(/^(\.\.[\\/])+/, '');
  if (!normalized.endsWith('.ts') && !normalized.endsWith('.m3u8')) {
    return res.status(400).json({ error: 'Tipo de archivo no permitido' });
  }
  const segmentPath = path.join(session.dir, normalized);
  if (!segmentPath.startsWith(session.dir + path.sep)) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  try { await fsp.access(segmentPath); } catch {
    return res.status(404).json({ error: 'Segmento no encontrado' });
  }

  if (normalized.endsWith('.m3u8')) {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store');
  } else {
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Cache-Control', 'public, max-age=86400');
  }

  const stat = await fsp.stat(segmentPath);
  touchDir(session.dir);
  res.setHeader('Content-Length', stat.size);
  fs.createReadStream(segmentPath).pipe(res);
});

// POST /api/videos/:id/progress
router.post('/:id/progress', asyncHandler(async (req, res) => {
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
}));

// GET /api/videos/:id/progress
router.get('/:id/progress', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const result = await pool.query(
    'SELECT * FROM watch_progress WHERE user_id = $1 AND video_id = $2',
    [userId, id]
  );

  res.json(result.rows[0] || { progress_seconds: 0, completed: false });
}));

// GET /api/videos/:id/next - Get next video (next episode or next movie in library)
router.get('/:id/next', asyncHandler(async (req, res) => {
  const videoId = parseId(req.params.id);
  if (!videoId) return res.status(400).json({ error: 'ID inválido' });

  const current = await pool.query(
    'SELECT v.id, v.title, v.series_id, v.season_id, v.episode_number, v.library_id, v.video_type, se.season_number FROM videos v LEFT JOIN seasons se ON v.season_id = se.id WHERE v.id = $1',
    [videoId]
  );
  if (current.rows.length === 0) return res.status(404).json({ error: 'Video no encontrado' });

  const video = current.rows[0];
  let next = null;

  if (video.video_type === 'episode' && video.series_id) {
    // Order by episode number, not title: sorting by title puts "Episodio 10"
    // before "Episodio 9". Episodes without a number sort last (NULL → a large
    // sentinel) and fall back to title, and (number, title) is compared as a
    // tuple so the ordering is total and matches the ORDER BY exactly.
    const sameSeasonNext = await pool.query(
      `SELECT v.id, v.title, v.episode_number, se.season_number, s.title as series_title
       FROM videos v
       LEFT JOIN seasons se ON v.season_id = se.id
       LEFT JOIN series s ON v.series_id = s.id
       WHERE v.series_id = $1
         AND v.season_id IS NOT DISTINCT FROM $2
         AND (COALESCE(v.episode_number, 2147483647), v.title) > (COALESCE($3::int, 2147483647), $4)
       ORDER BY COALESCE(v.episode_number, 2147483647) ASC, v.title ASC
       LIMIT 1`,
      [video.series_id, video.season_id, video.episode_number, video.title]
    );

    if (sameSeasonNext.rows.length > 0) {
      next = sameSeasonNext.rows[0];
    } else {
      // Try first episode of next season
      const nextSeasonEp = await pool.query(
        `SELECT v.id, v.title, v.episode_number, se.season_number, s.title as series_title
         FROM videos v
         LEFT JOIN seasons se ON v.season_id = se.id
         LEFT JOIN series s ON v.series_id = s.id
         WHERE v.series_id = $1 AND se.season_number > $2
         ORDER BY se.season_number ASC, COALESCE(v.episode_number, 2147483647) ASC, v.title ASC
         LIMIT 1`,
        [video.series_id, video.season_number || 0]
      );
      if (nextSeasonEp.rows.length > 0) {
        next = nextSeasonEp.rows[0];
      }
    }
  } else {
    // Movie: next one in the same library by title. Ties are broken by id so
    // two movies sharing a title don't skip each other.
    const nextMovie = await pool.query(
      `SELECT id, title FROM videos
       WHERE library_id = $1 AND video_type = 'movie' AND (title, id) > ($2, $3)
       ORDER BY title ASC, id ASC LIMIT 1`,
      [video.library_id, video.title, videoId]
    );
    if (nextMovie.rows.length > 0) {
      next = nextMovie.rows[0];
    }
  }

  res.json({ next });
}));

module.exports = router;

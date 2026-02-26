const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const multer = require('multer');
const { pool } = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const {
  extractEmbeddedSubtitles,
  findExternalSubtitles,
  searchOpenSubtitles,
  downloadOpenSubtitles,
  autoSearchOpenSubtitles,
  generateThumbnail,
  generateLibraryThumbnails,
  SUBS_DIR,
  THUMBS_DIR,
} = require('../services/subtitles');
const progress = require('../services/progress');

const router = express.Router();

// ===== SSE PROGRESS =====

// GET /api/subtitles/progress/stream/:taskId — SSE stream for a task
router.get('/progress/stream/:taskId', (req, res) => {
  const { taskId } = req.params;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx
  });
  res.write('\n');

  const ok = progress.subscribe(taskId, res);
  if (!ok) {
    // No task? Send completed immediately
    res.write(`data: ${JSON.stringify({ taskId, status: 'completed', percent: 100 })}\n\n`);
    res.end();
    return;
  }

  req.on('close', () => {
    progress.unsubscribe(taskId, res);
  });
});

// GET /api/subtitles/progress/active — Get all active tasks
router.get('/progress/active', (req, res) => {
  res.json(progress.getActiveTasks());
});

// ===== THUMBNAILS (must be before /:videoId to avoid conflict) =====

// POST /api/subtitles/thumbnails/generate/:videoId
router.post('/thumbnails/generate/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const videoResult = await pool.query('SELECT file_path FROM videos WHERE id = $1', [videoId]);

    if (videoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Video no encontrado' });
    }

    const filePath = videoResult.rows[0].file_path;
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    const thumbPath = await generateThumbnail(videoId, filePath);
    if (thumbPath) {
      res.json({ message: 'Thumbnail generado', thumbnail_path: thumbPath });
    } else {
      res.status(500).json({ error: 'No se pudo generar el thumbnail' });
    }
  } catch (err) {
    console.error('Generate thumbnail error:', err);
    res.status(500).json({ error: 'Error al generar thumbnail' });
  }
});

// POST /api/subtitles/thumbnails/library/:libraryId
router.post('/thumbnails/library/:libraryId', requireAdmin, async (req, res) => {
  try {
    const { libraryId } = req.params;
    const taskId = `thumbs:${libraryId}:${Date.now()}`;

    // Count videos that need thumbnails
    const countResult = await pool.query(
      'SELECT COUNT(*) as cnt FROM videos WHERE library_id = $1 AND thumbnail_path IS NULL',
      [libraryId]
    );
    const seriesCount = await pool.query(
      `SELECT COUNT(*) as cnt FROM series WHERE library_id = $1 AND thumbnail_path IS NULL`,
      [libraryId]
    );
    const total = parseInt(countResult.rows[0].cnt) + parseInt(seriesCount.rows[0].cnt);

    if (total === 0) {
      return res.json({ message: 'Todas las carátulas ya están generadas', taskId: null });
    }

    progress.createTask(taskId, `Generando carátulas (0/${total})`, total);
    res.json({ message: 'Generación de carátulas iniciada', taskId });

    // Run in background with progress
    (async () => {
      let done = 0;
      const videos = await pool.query(
        'SELECT id, file_path FROM videos WHERE library_id = $1 AND thumbnail_path IS NULL',
        [libraryId]
      );
      for (const video of videos.rows) {
        if (!fs.existsSync(video.file_path)) { done++; progress.updateTask(taskId, done, { label: `Generando carátulas (${done}/${total})` }); continue; }
        await generateThumbnail(video.id, video.file_path);
        done++;
        progress.updateTask(taskId, done, { label: `Generando carátulas (${done}/${total})` });
      }

      // Series thumbnails
      const seriesResult = await pool.query(
        `SELECT DISTINCT s.id as series_id,
                (SELECT v.id FROM videos v WHERE v.series_id = s.id ORDER BY v.season_id, v.episode_number LIMIT 1) as first_episode_id
         FROM series s
         WHERE s.library_id = $1 AND s.thumbnail_path IS NULL`,
        [libraryId]
      );
      for (const row of seriesResult.rows) {
        if (!row.first_episode_id) { done++; progress.updateTask(taskId, done, { label: `Generando carátulas (${done}/${total})` }); continue; }
        const vr = await pool.query('SELECT file_path FROM videos WHERE id = $1', [row.first_episode_id]);
        if (vr.rows.length > 0 && fs.existsSync(vr.rows[0].file_path)) {
          const seriesThumbPath = path.join(THUMBS_DIR, `series_${row.series_id}.jpg`);
          if (!fs.existsSync(seriesThumbPath)) {
            try {
              let seekTo = '00:02:00';
              try {
                const { stdout } = await execFileAsync('ffprobe', [
                  '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', vr.rows[0].file_path
                ], { timeout: 10000 });
                const sec = Math.floor(parseFloat(stdout.trim()) * 0.15);
                const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
                seekTo = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
              } catch {}
              await execFileAsync('ffmpeg', [
                '-y', '-loglevel', 'error', '-ss', seekTo, '-i', vr.rows[0].file_path,
                '-vframes', '1', '-q:v', '3', '-vf', 'scale=480:-1', seriesThumbPath
              ], { timeout: 15000 });
              if (fs.existsSync(seriesThumbPath)) {
                await pool.query('UPDATE series SET thumbnail_path = $1 WHERE id = $2', [seriesThumbPath, row.series_id]);
              }
            } catch {}
          }
        }
        done++;
        progress.updateTask(taskId, done, { label: `Generando carátulas (${done}/${total})` });
      }

      progress.completeTask(taskId, `✅ Carátulas generadas (${done})`);
      console.log(`✅ Generated thumbnails for library ${libraryId}: ${done}`);
    })().catch(err => {
      console.error('Library thumbnail generation error:', err);
      progress.failTask(taskId, err.message);
    });
  } catch (err) {
    console.error('Library thumbnail error:', err);
    res.status(500).json({ error: 'Error al generar thumbnails' });
  }
});

// POST /api/subtitles/library/:libraryId/extract-all - Extract subtitles for all videos in library
router.post('/library/:libraryId/extract-all', requireAdmin, async (req, res) => {
  try {
    const { libraryId } = req.params;
    const taskId = `subs:${libraryId}:${Date.now()}`;

    const videos = await pool.query(
      `SELECT v.id, v.file_path FROM videos v
       LEFT JOIN (SELECT video_id, COUNT(*) as cnt FROM subtitles GROUP BY video_id) s ON s.video_id = v.id
       WHERE v.library_id = $1 AND (s.cnt IS NULL OR s.cnt = 0)`,
      [libraryId]
    );

    const total = videos.rows.length;
    if (total === 0) {
      return res.json({ message: 'Todos los videos ya tienen subtítulos', taskId: null });
    }

    progress.createTask(taskId, `Extrayendo subtítulos (0/${total})`, total);
    res.json({ message: 'Extracción de subtítulos iniciada', taskId });

    // Run in background with progress
    (async () => {
      let extracted = 0;
      let done = 0;
      for (const video of videos.rows) {
        done++;
        if (!fs.existsSync(video.file_path)) {
          progress.updateTask(taskId, done, { label: `Extrayendo subtítulos (${done}/${total})` });
          continue;
        }
        try {
          const emb = await extractEmbeddedSubtitles(video.id, video.file_path);
          const ext = await findExternalSubtitles(video.id, video.file_path);
          if (emb.length + ext.length > 0) extracted++;
        } catch (err) {
          console.error(`Sub extraction error for video ${video.id}:`, err.message);
        }
        progress.updateTask(taskId, done, { label: `Extrayendo subtítulos (${done}/${total})` });
      }
      progress.completeTask(taskId, `✅ Subtítulos extraídos (${extracted}/${total})`);
      console.log(`✅ Extracted subtitles for ${extracted}/${total} videos in library ${libraryId}`);
    })().catch(err => {
      console.error('Library subtitle extraction error:', err);
      progress.failTask(taskId, err.message);
    });
  } catch (err) {
    console.error('Library subtitle error:', err);
    res.status(500).json({ error: 'Error al extraer subtítulos' });
  }
});

// GET /api/subtitles/thumbnails/file/:videoId
router.get('/thumbnails/file/:videoId', async (req, res) => {
  const { videoId } = req.params;

  let thumbPath = path.join(THUMBS_DIR, `${videoId}.jpg`);
  if (!fs.existsSync(thumbPath)) {
    thumbPath = path.join(THUMBS_DIR, `series_${videoId}.jpg`);
    if (!fs.existsSync(thumbPath)) {
      // Fallback: check poster_path in DB
      try {
        const result = await pool.query('SELECT poster_path FROM videos WHERE id = $1', [videoId]);
        if (result.rows.length > 0 && result.rows[0].poster_path && fs.existsSync(result.rows[0].poster_path)) {
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return res.sendFile(result.rows[0].poster_path);
        }
      } catch {}
      return res.status(404).json({ error: 'Thumbnail no encontrado' });
    }
  }

  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(thumbPath).pipe(res);
});

// GET /api/subtitles/thumbnails/series/:seriesId
router.get('/thumbnails/series/:seriesId', async (req, res) => {
  const { seriesId } = req.params;
  const thumbPath = path.join(THUMBS_DIR, `series_${seriesId}.jpg`);

  if (fs.existsSync(thumbPath)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return fs.createReadStream(thumbPath).pipe(res);
  }

  // Fallback: check poster_path in series table
  try {
    const result = await pool.query('SELECT poster_path FROM series WHERE id = $1', [seriesId]);
    if (result.rows.length > 0 && result.rows[0].poster_path && fs.existsSync(result.rows[0].poster_path)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(result.rows[0].poster_path);
    }
  } catch {}

  // Fallback: use thumbnail of first episode
  try {
    const ep = await pool.query(
      'SELECT id FROM videos WHERE series_id = $1 ORDER BY season_id, episode_number LIMIT 1',
      [seriesId]
    );
    if (ep.rows.length > 0) {
      const epThumb = path.join(THUMBS_DIR, `${ep.rows[0].id}.jpg`);
      if (fs.existsSync(epThumb)) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return fs.createReadStream(epThumb).pipe(res);
      }
    }
  } catch {}

  res.status(404).json({ error: 'Thumbnail no encontrado' });
});

// ===== SUBTITLES =====

// POST /api/subtitles/library/:libraryId/auto-opensubtitles — Bulk auto-search OpenSubtitles
router.post('/library/:libraryId/auto-opensubtitles', requireAdmin, async (req, res) => {
  try {
    const { libraryId } = req.params;

    // Get videos without subtitles in this library
    const result = await pool.query(
      `SELECT v.id, v.title, v.year, v.original_filename, v.video_type,
              s.title as series_title, se.season_number, v.episode_number
       FROM videos v
       LEFT JOIN series s ON v.series_id = s.id
       LEFT JOIN seasons se ON v.season_id = se.id
       LEFT JOIN subtitles sub ON sub.video_id = v.id
       WHERE v.library_id = $1
       GROUP BY v.id, v.title, v.year, v.original_filename, v.video_type,
                s.title, se.season_number, v.episode_number
       HAVING COUNT(sub.id) = 0`,
      [libraryId]
    );

    const videos = result.rows;
    if (videos.length === 0) {
      return res.json({ message: 'Todos los videos ya tienen subtítulos', found: 0, total: 0 });
    }

    // Create progress task
    const taskId = `opensub-${libraryId}-${Date.now()}`;
    progress.createTask(taskId, `OpenSubtitles: buscando subs (0/${videos.length})`, 'subtitles');

    // Respond immediately
    res.json({ message: `Buscando subtítulos para ${videos.length} videos`, taskId, total: videos.length });

    // Process in background
    let found = 0;
    let errors = 0;
    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      const label = v.series_title || v.title || v.original_filename;
      progress.updateTask(taskId, Math.round(((i) / videos.length) * 100),
        `OpenSub: ${label} (${i + 1}/${videos.length})`);

      try {
        const result = await autoSearchOpenSubtitles(v.id);
        if (result.success && !result.skipped) {
          found++;
        }
      } catch (err) {
        errors++;
        console.error(`OpenSubtitles auto-search error for video ${v.id}:`, err.message);
      }

      // Respect OpenSubtitles rate limit (max 5 requests/sec on free tier)
      if (i < videos.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    progress.completeTask(taskId, `OpenSub: ${found} subs encontrados de ${videos.length} videos`);
    console.log(`✅ OpenSubtitles auto-search complete: ${found} found, ${errors} errors, ${videos.length} total`);
  } catch (err) {
    console.error('Auto OpenSubtitles error:', err);
    // Don't send response here since we already sent one
  }
});

// POST /api/subtitles/batch-check - Get subtitle counts for multiple video IDs at once
router.post('/batch-check', async (req, res) => {
  try {
    const { videoIds } = req.body;
    if (!Array.isArray(videoIds) || videoIds.length === 0) {
      return res.json({});
    }
    // Limit to 200 IDs per request
    const ids = videoIds.slice(0, 200).map(Number).filter(n => n > 0);
    if (ids.length === 0) return res.json({});

    const result = await pool.query(
      `SELECT video_id, COUNT(*) as count
       FROM subtitles
       WHERE video_id = ANY($1)
       GROUP BY video_id`,
      [ids]
    );

    const counts = {};
    for (const row of result.rows) {
      counts[row.video_id] = parseInt(row.count);
    }
    // Fill missing IDs with 0
    for (const id of ids) {
      if (!(id in counts)) counts[id] = 0;
    }
    res.json(counts);
  } catch (err) {
    console.error('Batch check subtitles error:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/subtitles/:videoId
router.get('/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const result = await pool.query(
      'SELECT * FROM subtitles WHERE video_id = $1 ORDER BY is_default DESC, label ASC',
      [videoId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get subtitles error:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/subtitles/:videoId/file/:subId - Serve subtitle file (VTT)
router.get('/:videoId/file/:subId', async (req, res) => {
  try {
    const { videoId, subId } = req.params;
    const result = await pool.query(
      'SELECT * FROM subtitles WHERE id = $1 AND video_id = $2',
      [subId, videoId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Subtítulo no encontrado' });
    }

    const sub = result.rows[0];
    if (!fs.existsSync(sub.file_path)) {
      return res.status(404).json({ error: 'Archivo de subtítulo no encontrado' });
    }

    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    fs.createReadStream(sub.file_path).pipe(res);
  } catch (err) {
    console.error('Serve subtitle error:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/subtitles/:videoId/extract - Extract embedded subtitles
router.post('/:videoId/extract', async (req, res) => {
  try {
    const { videoId } = req.params;

    // Skip if already extracted
    const existing = await pool.query('SELECT COUNT(*) as count FROM subtitles WHERE video_id = $1', [videoId]);
    if (parseInt(existing.rows[0].count) > 0) {
      return res.json({ message: 'Subtítulos ya extraídos', embedded: 0, external: 0, skipped: true });
    }

    const videoResult = await pool.query('SELECT file_path FROM videos WHERE id = $1', [videoId]);

    if (videoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Video no encontrado' });
    }

    const filePath = videoResult.rows[0].file_path;
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo de video no encontrado' });
    }

    console.log(`📝 Extracting subtitles from video ${videoId}`);

    // Extract embedded + find external
    const [embedded, external] = await Promise.all([
      extractEmbeddedSubtitles(videoId, filePath),
      findExternalSubtitles(videoId, filePath),
    ]);

    res.json({
      message: `Encontrados ${embedded.length} embebidos y ${external.length} externos`,
      embedded: embedded.length,
      external: external.length,
    });
  } catch (err) {
    console.error('Extract subtitles error:', err);
    res.status(500).json({ error: 'Error al extraer subtítulos' });
  }
});

// POST /api/subtitles/:videoId/search - Search OpenSubtitles
router.post('/:videoId/search', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      // Use video title as default search
      const videoResult = await pool.query(
        `SELECT v.title, s.title as series_title, se.season_number, v.episode_number
         FROM videos v
         LEFT JOIN series s ON v.series_id = s.id
         LEFT JOIN seasons se ON v.season_id = se.id
         WHERE v.id = $1`,
        [req.params.videoId]
      );

      if (videoResult.rows.length === 0) {
        return res.status(404).json({ error: 'Video no encontrado' });
      }

      const v = videoResult.rows[0];
      let searchQuery = v.series_title || v.title;
      if (v.season_number && v.episode_number) {
        searchQuery += ` S${String(v.season_number).padStart(2, '0')}E${String(v.episode_number).padStart(2, '0')}`;
      }

      const results = await searchOpenSubtitles(searchQuery);
      return res.json({ query: searchQuery, results });
    }

    const results = await searchOpenSubtitles(query);
    res.json({ query, results });
  } catch (err) {
    console.error('Search subtitles error:', err);
    res.status(500).json({ error: 'Error al buscar subtítulos' });
  }
});

// POST /api/subtitles/:videoId/download - Download from OpenSubtitles
router.post('/:videoId/download', async (req, res) => {
  try {
    const { videoId } = req.params;
    const { file_id } = req.body;

    if (!file_id) {
      return res.status(400).json({ error: 'file_id requerido' });
    }

    console.log(`📥 Downloading subtitle from OpenSubtitles: file_id=${file_id} for video ${videoId}`);
    const result = await downloadOpenSubtitles(file_id, videoId);

    if (result.success) {
      res.json({
        message: `Subtítulo descargado exitosamente`,
        subtitles: result.subtitles,
      });
    } else {
      res.status(500).json({ error: result.error || 'Error al descargar subtítulo' });
    }
  } catch (err) {
    console.error('Download subtitle error:', err);
    res.status(500).json({ error: 'Error al descargar subtítulo' });
  }
});

// POST /api/subtitles/:videoId/upload - Upload a subtitle file (admin only)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.srt', '.vtt', '.ass', '.ssa', '.sub'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

router.post('/:videoId/upload', requireAdmin, upload.single('subtitle'), async (req, res) => {
  try {
    const videoId = parseInt(req.params.videoId, 10);
    if (isNaN(videoId)) return res.status(400).json({ error: 'ID inválido' });
    if (!req.file) return res.status(400).json({ error: 'No se proporcionó archivo de subtítulo válido' });

    const label = req.body.label || req.file.originalname.replace(/\.[^.]+$/, '');
    const language = req.body.language || 'es';
    const ext = path.extname(req.file.originalname).toLowerCase();
    const format = ext === '.srt' ? 'srt' : ext === '.vtt' ? 'vtt' : ext === '.ass' || ext === '.ssa' ? 'ass' : 'sub';

    // Save file to subs directory
    const videoSubDir = path.join(SUBS_DIR, String(videoId));
    if (!fs.existsSync(videoSubDir)) fs.mkdirSync(videoSubDir, { recursive: true });

    // If SRT, convert to VTT
    let finalPath, finalFormat;
    if (format === 'srt') {
      const vttContent = 'WEBVTT\n\n' + req.file.buffer.toString('utf-8')
        .replace(/\r\n/g, '\n')
        .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
      finalPath = path.join(videoSubDir, `upload_${Date.now()}.vtt`);
      finalFormat = 'vtt';
      fs.writeFileSync(finalPath, vttContent, 'utf-8');
    } else {
      finalPath = path.join(videoSubDir, `upload_${Date.now()}${ext}`);
      finalFormat = format;
      fs.writeFileSync(finalPath, req.file.buffer);
    }

    const result = await pool.query(
      `INSERT INTO subtitles (video_id, label, language, format, file_path, source, is_default)
       VALUES ($1, $2, $3, $4, $5, 'upload', false) RETURNING *`,
      [videoId, label, language, finalFormat, finalPath]
    );

    // Return updated subtitle list
    const subs = await pool.query(
      'SELECT id, video_id, label, language, format, source, is_default FROM subtitles WHERE video_id = $1 ORDER BY is_default DESC, id ASC',
      [videoId]
    );
    res.json({ subtitle: result.rows[0], subtitles: subs.rows });
  } catch (err) {
    console.error('Upload subtitle error:', err);
    res.status(500).json({ error: 'Error al subir subtítulo' });
  }
});

// DELETE /api/subtitles/:videoId/:subId - Delete a subtitle (admin only)
router.delete('/:videoId/:subId', requireAdmin, async (req, res) => {
  try {
    const videoId = parseInt(req.params.videoId, 10);
    const subId = parseInt(req.params.subId, 10);
    if (isNaN(videoId) || isNaN(subId)) return res.status(400).json({ error: 'ID inválido' });

    const result = await pool.query(
      'SELECT * FROM subtitles WHERE id = $1 AND video_id = $2',
      [subId, videoId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Subtítulo no encontrado' });
    }

    // Delete file
    const sub = result.rows[0];
    try {
      if (fs.existsSync(sub.file_path)) {
        fs.unlinkSync(sub.file_path);
      }
    } catch {}

    await pool.query('DELETE FROM subtitles WHERE id = $1', [subId]);
    res.json({ message: 'Subtítulo eliminado' });
  } catch (err) {
    console.error('Delete subtitle error:', err);
    res.status(500).json({ error: 'Error al eliminar subtítulo' });
  }
});

// POST /api/subtitles/cron/run — Manually trigger subtitle download cron
router.post('/cron/run', requireAdmin, async (req, res) => {
  try {
    const { downloadMissingSubtitles } = require('../services/subtitleCron');
    res.json({ message: 'Cron de subtítulos iniciado en segundo plano' });
    // Run in background (don't await)
    downloadMissingSubtitles().catch(err => console.error('Manual cron error:', err.message));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

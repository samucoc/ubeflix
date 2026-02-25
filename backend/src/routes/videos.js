const express = require('express');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const { pool } = require('../config/db');

const router = express.Router();

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

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get video error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/videos/:id/stream
router.get('/:id/stream', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT file_path FROM videos WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Video no encontrado' });
    }

    const filePath = result.rows[0].file_path;

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo de video no encontrado en disco' });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    const mimeType = mime.lookup(filePath) || 'video/mp4';

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;

      const file = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
      });

      file.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
      });

      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    console.error('Stream error:', err);
    res.status(500).json({ error: 'Error al transmitir video' });
  }
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

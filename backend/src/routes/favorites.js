const express = require('express');
const { pool } = require('../config/db');

const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

// GET /api/favorites — List current user's favorites
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const result = await pool.query(`
    SELECT f.id as favorite_id, f.created_at as favorited_at,
      CASE 
        WHEN f.video_id IS NOT NULL THEN 'video'
        WHEN f.series_id IS NOT NULL THEN 'series'
      END as favorite_type,
      v.id as video_id, v.title as video_title, v.poster_path as video_poster, v.video_type,
      v.year as video_year,
      s.id as series_id, s.title as series_title, s.poster_path as series_poster,
      s.year as series_year
    FROM favorites f
    LEFT JOIN videos v ON f.video_id = v.id
    LEFT JOIN series s ON f.series_id = s.id
    WHERE f.user_id = $1
    ORDER BY f.created_at DESC
  `, [userId]);

  // Normalize response
  const favorites = result.rows.map(row => ({
    favorite_id: row.favorite_id,
    favorited_at: row.favorited_at,
    type: row.favorite_type,
    id: row.video_id || row.series_id,
    title: row.video_title || row.series_title,
    poster_path: row.video_poster || row.series_poster,
    year: row.video_year || row.series_year,
    video_type: row.video_type || 'series',
  }));

  res.json(favorites);
}));

// POST /api/favorites — Toggle a favorite
router.post('/', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { video_id, series_id } = req.body;

  if (!video_id && !series_id) {
    return res.status(400).json({ error: 'Se requiere video_id o series_id' });
  }

  // Check if already favorited
  let existing;
  if (video_id) {
    existing = await pool.query(
      'SELECT id FROM favorites WHERE user_id = $1 AND video_id = $2',
      [userId, video_id]
    );
  } else {
    existing = await pool.query(
      'SELECT id FROM favorites WHERE user_id = $1 AND series_id = $2',
      [userId, series_id]
    );
  }

  if (existing.rows.length > 0) {
    // Remove favorite
    await pool.query('DELETE FROM favorites WHERE id = $1', [existing.rows[0].id]);
    return res.json({ favorited: false, message: 'Eliminado de favoritos' });
  }

  // Add favorite. ON CONFLICT covers the gap between the check above and this
  // insert: two fast clicks would otherwise create duplicate rows.
  if (video_id) {
    await pool.query(
      'INSERT INTO favorites (user_id, video_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, video_id]
    );
  } else {
    await pool.query(
      'INSERT INTO favorites (user_id, series_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, series_id]
    );
  }

  res.status(201).json({ favorited: true, message: 'Agregado a favoritos' });
}));

// GET /api/favorites/check — Check if item is favorited
router.get('/check', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { video_id, series_id } = req.query;

  let result;
  if (video_id) {
    result = await pool.query(
      'SELECT id FROM favorites WHERE user_id = $1 AND video_id = $2',
      [userId, video_id]
    );
  } else if (series_id) {
    result = await pool.query(
      'SELECT id FROM favorites WHERE user_id = $1 AND series_id = $2',
      [userId, series_id]
    );
  } else {
    return res.json({ favorited: false });
  }

  res.json({ favorited: result.rows.length > 0 });
}));

module.exports = router;

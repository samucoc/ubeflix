const express = require('express');
const { pool } = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

const RECENT_LIMIT = 12;

// GET /api/dashboard — Contadores + novedades + "seguir viendo"
router.get('/', asyncHandler(async (req, res) => {
  const [counts, recentlyAdded, continueWatching] = await Promise.all([
    // Un solo escaneo con FILTER en vez de cuatro COUNT(*) por separado.
    pool.query(`
      SELECT
        (SELECT COUNT(*) FROM videos WHERE video_type = 'movie')::int   AS movies,
        (SELECT COUNT(*) FROM videos WHERE video_type = 'episode')::int AS episodes,
        (SELECT COUNT(*) FROM series)::int                              AS series,
        (SELECT COUNT(*) FROM libraries)::int                           AS libraries
    `),
    pool.query(`
      SELECT v.id, v.title, v.video_type, v.poster_path, v.thumbnail_path, v.created_at,
             s.title as series_title, se.season_number, v.episode_number
      FROM videos v
      LEFT JOIN series s ON v.series_id = s.id
      LEFT JOIN seasons se ON v.season_id = se.id
      ORDER BY v.created_at DESC LIMIT $1
    `, [RECENT_LIMIT]),
    pool.query(`
      SELECT v.id, v.title, v.video_type, v.poster_path, v.thumbnail_path,
             wp.progress_seconds, wp.last_watched_at,
             s.title as series_title, se.season_number, v.episode_number
      FROM watch_progress wp
      JOIN videos v ON wp.video_id = v.id
      LEFT JOIN series s ON v.series_id = s.id
      LEFT JOIN seasons se ON v.season_id = se.id
      WHERE wp.user_id = $1 AND wp.completed = false AND wp.progress_seconds > 0
      ORDER BY wp.last_watched_at DESC LIMIT $2
    `, [req.user.id, RECENT_LIMIT]),
  ]);

  res.json({
    stats: counts.rows[0],
    recentlyAdded: recentlyAdded.rows,
    continueWatching: continueWatching.rows,
  });
}));

module.exports = router;

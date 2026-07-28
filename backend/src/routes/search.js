const express = require('express');
const { pool } = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

const SEARCH_LIMIT = 20;

// GET /api/search?q= — Búsqueda unificada sobre películas y series
router.get('/', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) {
    return res.json({ movies: [], series: [] });
  }

  const searchTerm = `%${q}%`;

  const [moviesResult, seriesResult] = await Promise.all([
    pool.query(`
      SELECT v.id, v.title, v.poster_path, v.thumbnail_path, v.year, v.video_type
      FROM videos v
      WHERE v.title ILIKE $1 AND v.video_type = 'movie'
      ORDER BY v.title ASC
      LIMIT $2
    `, [searchTerm, SEARCH_LIMIT]),
    pool.query(`
      SELECT s.id, s.title, s.poster_path, s.thumbnail_path, s.year,
        (SELECT COUNT(*) FROM videos WHERE series_id = s.id) as episode_count
      FROM series s
      WHERE s.title ILIKE $1
      ORDER BY s.title ASC
      LIMIT $2
    `, [searchTerm, SEARCH_LIMIT]),
  ]);

  res.json({
    movies: moviesResult.rows,
    series: seriesResult.rows,
  });
}));

module.exports = router;

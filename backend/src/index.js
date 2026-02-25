const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { pool } = require('./config/db');
const { authenticateToken } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const videosRoutes = require('./routes/videos');
const librariesRoutes = require('./routes/libraries');
const favoritesRoutes = require('./routes/favorites');
const usersRoutes = require('./routes/users');

const app = express();
const PORT = process.env.PORT || 5566;

// Middleware
app.use(cors({
  origin: ['http://localhost:3344', 'http://localhost:5173'],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'ubeFlix API', timestamp: new Date().toISOString() });
});

// Public routes
app.use('/api/auth', (req, res, next) => {
  // /login and /register are public, /me requires auth
  if (req.path === '/me') {
    return authenticateToken(req, res, next);
  }
  next();
}, authRoutes);

// Protected routes
app.use('/api/videos', authenticateToken, videosRoutes);
app.use('/api/libraries', authenticateToken, librariesRoutes);
app.use('/api/favorites', authenticateToken, favoritesRoutes);
app.use('/api/users', authenticateToken, usersRoutes);

// Serve video thumbnails / posters from disk
app.get('/api/images/*', authenticateToken, (req, res) => {
  const imagePath = req.params[0];
  if (!imagePath || imagePath.includes('..')) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  // The image path is stored as absolute in db
  if (fs.existsSync(imagePath)) {
    res.sendFile(imagePath);
  } else {
    res.status(404).json({ error: 'Image not found' });
  }
});

// Unified search — search across movies and series
app.get('/api/search', authenticateToken, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length === 0) {
      return res.json({ movies: [], series: [] });
    }

    const searchTerm = `%${q.trim()}%`;

    const [moviesResult, seriesResult] = await Promise.all([
      pool.query(`
        SELECT v.id, v.title, v.poster_path, v.year, v.video_type
        FROM videos v
        WHERE v.title ILIKE $1 AND v.video_type = 'movie'
        ORDER BY v.title ASC
        LIMIT 20
      `, [searchTerm]),
      pool.query(`
        SELECT s.id, s.title, s.poster_path, s.year,
          (SELECT COUNT(*) FROM videos WHERE series_id = s.id) as episode_count
        FROM series s
        WHERE s.title ILIKE $1
        ORDER BY s.title ASC
        LIMIT 20
      `, [searchTerm]),
    ]);

    res.json({
      movies: moviesResult.rows,
      series: seriesResult.rows,
    });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Dashboard stats
app.get('/api/dashboard', authenticateToken, async (req, res) => {
  try {
    const [movies, episodes, series, libraries, recentlyAdded, continueWatching] = await Promise.all([
      pool.query("SELECT COUNT(*) as count FROM videos WHERE video_type = 'movie'"),
      pool.query("SELECT COUNT(*) as count FROM videos WHERE video_type = 'episode'"),
      pool.query('SELECT COUNT(*) as count FROM series'),
      pool.query('SELECT COUNT(*) as count FROM libraries'),
      pool.query(`
        SELECT v.id, v.title, v.video_type, v.poster_path, v.created_at,
               s.title as series_title, se.season_number, v.episode_number
        FROM videos v
        LEFT JOIN series s ON v.series_id = s.id
        LEFT JOIN seasons se ON v.season_id = se.id
        ORDER BY v.created_at DESC LIMIT 12
      `),
      pool.query(`
        SELECT v.id, v.title, v.video_type, v.poster_path, wp.progress_seconds, wp.last_watched_at,
               s.title as series_title, se.season_number, v.episode_number
        FROM watch_progress wp
        JOIN videos v ON wp.video_id = v.id
        LEFT JOIN series s ON v.series_id = s.id
        LEFT JOIN seasons se ON v.season_id = se.id
        WHERE wp.user_id = $1 AND wp.completed = false AND wp.progress_seconds > 0
        ORDER BY wp.last_watched_at DESC LIMIT 12
      `, [req.user.id]),
    ]);

    res.json({
      stats: {
        movies: parseInt(movies.rows[0].count),
        episodes: parseInt(episodes.rows[0].count),
        series: parseInt(series.rows[0].count),
        libraries: parseInt(libraries.rows[0].count),
      },
      recentlyAdded: recentlyAdded.rows,
      continueWatching: continueWatching.rows,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎬 ubeFlix API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  console.log(`   Videos path: ${process.env.VIDEOS_PATH || './videos'}\n`);
});

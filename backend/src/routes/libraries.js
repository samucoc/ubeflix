const express = require('express');
const { pool } = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const { scanLibrary } = require('../services/scanner');

const router = express.Router();

// GET /api/libraries
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM libraries ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error('Get libraries error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/libraries
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, path, library_type } = req.body;

    if (!name || !path) {
      return res.status(400).json({ error: 'Nombre y ruta son requeridos' });
    }

    const type = library_type || 'movies';
    if (!['movies', 'series'].includes(type)) {
      return res.status(400).json({ error: 'Tipo debe ser "movies" o "series"' });
    }

    const result = await pool.query(
      'INSERT INTO libraries (name, path, library_type) VALUES ($1, $2, $3) RETURNING *',
      [name, path, type]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create library error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/libraries/:id/scan
router.post('/:id/scan', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const libResult = await pool.query('SELECT * FROM libraries WHERE id = $1', [id]);
    if (libResult.rows.length === 0) {
      return res.status(404).json({ error: 'Biblioteca no encontrada' });
    }

    const library = libResult.rows[0];

    // Start scan in background
    scanLibrary(library).catch(err => {
      console.error(`Scan error for library ${id}:`, err);
    });

    // Update last_scanned_at
    await pool.query('UPDATE libraries SET last_scanned_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);

    res.json({ message: 'Escaneo iniciado', library });
  } catch (err) {
    console.error('Scan library error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/libraries/:id
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM libraries WHERE id = $1', [id]);
    res.json({ message: 'Biblioteca eliminada' });
  } catch (err) {
    console.error('Delete library error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;

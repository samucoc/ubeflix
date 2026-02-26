const express = require('express');
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const { scanLibrary } = require('../services/scanner');

const router = express.Router();

// GET /api/libraries/browse — Browse directories on the filesystem
router.get('/browse', async (req, res) => {
  try {
    const targetPath = req.query.path || '/host';
    const resolvedPath = path.resolve(targetPath);

    // Security: prevent path traversal
    if (resolvedPath.includes('..')) {
      return res.status(400).json({ error: 'Ruta inválida' });
    }

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'La ruta no existe' });
    }

    const stat = fs.statSync(resolvedPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'La ruta no es un directorio' });
    }

    const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
    const directories = entries
      .filter(entry => {
        if (!entry.isDirectory()) return false;
        // Skip hidden folders, system folders
        if (entry.name.startsWith('.')) return false;
        if (entry.name.startsWith('$')) return false;
        const skip = ['proc', 'sys', 'dev', 'run', 'snap', 'lost+found', 'node_modules',
                      'System Volume Information', 'Windows', '$Recycle.Bin', '$WinREAgent',
                      'Recovery', 'PerfLogs', 'Config.Msi', 'Documents and Settings',
                      'boot', 'etc', 'tmp', 'var', 'usr', 'lib', 'lib64', 'sbin', 'bin',
                      'DumpStack.log.tmp', 'wsl', 'wslg'];
        if (skip.includes(entry.name)) return false;
        // Check readable
        try {
          fs.accessSync(path.join(resolvedPath, entry.name), fs.constants.R_OK);
          return true;
        } catch {
          return false;
        }
      })
      .map(entry => {
        const entryPath = path.join(resolvedPath, entry.name);
        // If we're at /host level, show drive labels
        const isHostRoot = resolvedPath === '/host';
        return {
          name: isHostRoot ? `Disco ${entry.name.toUpperCase()}:` : entry.name,
          path: entryPath,
          isDrive: isHostRoot,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    // Don't allow navigating above /host
    const isAtHostRoot = resolvedPath === '/host';
    const parent = isAtHostRoot ? null : path.dirname(resolvedPath);

    res.json({
      current: resolvedPath,
      parent,
      directories,
      isHostRoot: isAtHostRoot,
    });
  } catch (err) {
    console.error('Browse error:', err);
    res.status(500).json({ error: 'Error al explorar el directorio' });
  }
});

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

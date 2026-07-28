const express = require('express');
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const { scanLibrary } = require('../services/scanner');

const { asyncHandler } = require('../utils/asyncHandler');

const { requireNumericParams } = require('../utils/params');

const router = express.Router();

// Los ids de ruta van directo a la base: validarlos acá evita un 500 por `/api/x/abc`.
requireNumericParams(router, 'id');

function normalizeLocations(body = {}) {
  const candidates = [];

  if (Array.isArray(body.locations)) candidates.push(...body.locations);
  if (Array.isArray(body.paths)) candidates.push(...body.paths);
  if (body.path) candidates.push(body.path);

  const unique = [];
  const seen = new Set();

  for (const raw of candidates) {
    if (typeof raw !== 'string') continue;
    const normalized = raw.trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }

  return unique;
}


async function hydrateLibrariesWithLocations(libraryRows) {
  if (!libraryRows.length) return [];

  const ids = libraryRows.map((l) => l.id);
  const locResult = await pool.query(
    'SELECT library_id, path FROM library_locations WHERE library_id = ANY($1) ORDER BY library_id, position, id',
    [ids]
  );

  const byLibrary = new Map();
  for (const row of locResult.rows) {
    if (!byLibrary.has(row.library_id)) byLibrary.set(row.library_id, []);
    byLibrary.get(row.library_id).push(row.path);
  }

  return libraryRows.map((library) => {
    const locations = byLibrary.get(library.id) || (library.path ? [library.path] : []);
    return {
      ...library,
      path: locations[0] || library.path,
      locations,
    };
  });
}

// Filesystem error codes that mean a /host drive is mounted-but-unreachable
// (typically an external/USB drive disconnected in Windows, leaving a stale
// WSL2 mount). Distinct from ENOENT, which means the path genuinely doesn't exist.
const DISCONNECTED_CODES = new Set(['ENODEV', 'ESTALE', 'EIO', 'ENXIO']);

// Build a user-facing "drive disconnected" message. If the path lives under a
// mapped Windows drive (/host/<letter>), name the drive and how to fix it.
function disconnectedMessage(resolvedPath) {
  const m = /^\/host\/([a-z])(?:\/|$)/.exec(resolvedPath);
  if (m) {
    const letter = m[1].toUpperCase();
    return `El disco ${letter}: está desconectado. Reconectalo en Windows y remontalo (remount-host-drive.ps1 ${letter}).`;
  }
  return 'El almacenamiento no está disponible: el dispositivo está desconectado.';
}

// GET /api/libraries/remount-config — Config for the host remount agent.
// The frontend (running in the host browser) uses this to call the agent
// directly. Only authenticated users reach this (router is behind auth).
router.get('/remount-config', (req, res) => {
  res.json({
    url: process.env.REMOUNT_AGENT_URL || 'http://localhost:9797',
    token: process.env.REMOUNT_AGENT_TOKEN || '',
    enabled: !!process.env.REMOUNT_AGENT_URL,
  });
});

// GET /api/libraries/browse — Browse directories on the filesystem
router.get('/browse', async (req, res) => {
  try {
    let targetPath = req.query.path || '/host';

    // Normalize Windows-style drive paths to /host/<letter>
    // Handles: "h:", "H:", "H:\", "H:/", "H:\foo\bar", "H:/foo/bar"
    const winDriveAbs = /^([a-zA-Z]):[/\\](.*)$/;
    const winDriveOnly = /^([a-zA-Z]):$/;
    if (winDriveAbs.test(targetPath)) {
      targetPath = targetPath.replace(winDriveAbs, (_, letter, rest) =>
        `/host/${letter.toLowerCase()}/${rest}`.replace(/\\/g, '/').replace(/\/+$/, '')
      );
    } else if (winDriveOnly.test(targetPath)) {
      targetPath = `/host/${targetPath[0].toLowerCase()}`;
    }

    const resolvedPath = path.resolve(targetPath);

    // Security: must stay within /host or be a valid absolute path
    if (resolvedPath.includes('..')) {
      return res.status(400).json({ error: 'Ruta inválida' });
    }

    let stat;
    try {
      stat = fs.statSync(resolvedPath);
    } catch (statErr) {
      if (statErr.code === 'ENOENT') {
        return res.status(404).json({ error: 'La ruta no existe' });
      }
      if (DISCONNECTED_CODES.has(statErr.code)) {
        return res.status(503).json({ error: disconnectedMessage(resolvedPath) });
      }
      if (statErr.code === 'EACCES' || statErr.code === 'EPERM') {
        return res.status(403).json({ error: `Sin permisos para acceder a: ${resolvedPath}` });
      }
      throw statErr;
    }
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'La ruta no es un directorio' });
    }

    let entries;
    try {
      entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
    } catch (readErr) {
      if (DISCONNECTED_CODES.has(readErr.code)) {
        return res.status(503).json({ error: disconnectedMessage(resolvedPath) });
      }
      return res.status(403).json({ error: `Sin permisos para leer el directorio: ${resolvedPath}` });
    }
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
    if (DISCONNECTED_CODES.has(err.code)) {
      return res.status(503).json({ error: disconnectedMessage(path.resolve(req.query.path || '/host')) });
    }
    res.status(500).json({ error: 'Error al explorar el directorio' });
  }
});

// GET /api/libraries
router.get('/', asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT * FROM libraries ORDER BY name');
  const libraries = await hydrateLibrariesWithLocations(result.rows);
  res.json(libraries);
}));

// POST /api/libraries
router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  const { name, library_type } = req.body;
  const locations = normalizeLocations(req.body);

  if (!name || !name.trim() || locations.length === 0) {
    return res.status(400).json({ error: 'Nombre y al menos una ruta son requeridos' });
  }

  const type = library_type || 'movies';
  if (!['movies', 'series', 'comics'].includes(type)) {
    return res.status(400).json({ error: 'Tipo debe ser "movies", "series" o "comics"' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      'INSERT INTO libraries (name, path, library_type) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), locations[0], type]
    );

    for (let i = 0; i < locations.length; i++) {
      await client.query(
        'INSERT INTO library_locations (library_id, path, position) VALUES ($1, $2, $3)',
        [result.rows[0].id, locations[i], i]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      ...result.rows[0],
      path: locations[0],
      locations,
    });
  } catch (txErr) {
    await client.query('ROLLBACK');
    throw txErr;
  } finally {
    client.release();
  }
}));

// POST /api/libraries/:id/scan
router.post('/:id/scan', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const libResult = await pool.query('SELECT * FROM libraries WHERE id = $1', [id]);
  if (libResult.rows.length === 0) {
    return res.status(404).json({ error: 'Biblioteca no encontrada' });
  }

  const [library] = await hydrateLibrariesWithLocations(libResult.rows);

  if (library.library_type === 'comics') {
    // Comics libraries use a dedicated scanner
    const { scanComicsLibrary } = require('../services/comicReader');
    scanComicsLibrary(library).catch(err => {
      console.error(`Comics scan error for library ${id}:`, err);
    });
    await pool.query('UPDATE libraries SET last_scanned_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
    return res.json({ message: 'Escaneo de comics iniciado', library });
  }

  // Start scan in background
  scanLibrary(library).catch(err => {
    console.error(`Scan error for library ${id}:`, err);
  });

  // Update last_scanned_at
  await pool.query('UPDATE libraries SET last_scanned_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);

  res.json({ message: 'Escaneo iniciado', library });
}));

// DELETE /api/libraries/:id
router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await pool.query('DELETE FROM libraries WHERE id = $1', [id]);
  res.json({ message: 'Biblioteca eliminada' });
}));

// PUT /api/libraries/:id
router.put('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  const hasLocationsInPayload = Array.isArray(req.body.locations) || Array.isArray(req.body.paths) || typeof req.body.path === 'string';
  const locations = hasLocationsInPayload ? normalizeLocations(req.body) : null;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'El nombre es requerido' });
  }

  if (hasLocationsInPayload && locations.length === 0) {
    return res.status(400).json({ error: 'Debes enviar al menos una ruta' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      'UPDATE libraries SET name = $1, path = COALESCE($2, path) WHERE id = $3 RETURNING *',
      [name.trim(), locations ? locations[0] : null, id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Biblioteca no encontrada' });
    }

    if (locations) {
      await client.query('DELETE FROM library_locations WHERE library_id = $1', [id]);
      for (let i = 0; i < locations.length; i++) {
        await client.query(
          'INSERT INTO library_locations (library_id, path, position) VALUES ($1, $2, $3)',
          [id, locations[i], i]
        );
      }
    }

    await client.query('COMMIT');

    const [library] = await hydrateLibrariesWithLocations(result.rows);
    res.json(library);
  } catch (txErr) {
    await client.query('ROLLBACK');
    throw txErr;
  } finally {
    client.release();
  }
}));

module.exports = router;

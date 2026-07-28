const express = require('express');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

// Paths come from the scanner as absolute paths, so this endpoint takes an
// absolute path from the client. Without an allowlist that is arbitrary file
// read for any logged-in user (`/api/images//etc/passwd`), so every request is
// checked against the roots the scanner is actually allowed to index.
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);
const STATIC_IMAGE_ROOTS = ['/tmp/ubeflix-thumbs'];
const IMAGE_ROOTS_TTL_MS = 60 * 1000;
let imageRootsCache = { roots: null, ts: 0 };

function staticImageRoots() {
  const roots = STATIC_IMAGE_ROOTS.map((r) => path.resolve(r));
  if (process.env.VIDEOS_PATH) roots.push(path.resolve(process.env.VIDEOS_PATH));
  return roots;
}

// Library paths are user-configurable, so the allowlist is read from the DB and
// cached briefly. On a DB error we fall back to the static roots — never to
// "allow everything".
async function getAllowedImageRoots() {
  if (imageRootsCache.roots && Date.now() - imageRootsCache.ts < IMAGE_ROOTS_TTL_MS) {
    return imageRootsCache.roots;
  }

  const roots = new Set(staticImageRoots());
  try {
    const { rows } = await pool.query(`
      SELECT path FROM libraries WHERE path IS NOT NULL AND path <> ''
      UNION
      SELECT path FROM library_locations WHERE path IS NOT NULL AND path <> ''
    `);
    for (const row of rows) roots.add(path.resolve(row.path));
  } catch (err) {
    console.warn('No se pudieron cargar las rutas de bibliotecas para /api/images:', err.message);
    return staticImageRoots();
  }

  imageRootsCache = { roots: [...roots], ts: Date.now() };
  return imageRootsCache.roots;
}

function isInsideAllowedRoot(resolvedPath, roots) {
  return roots.some((root) => resolvedPath === root || resolvedPath.startsWith(root + path.sep));
}

// GET /api/images/<ruta absoluta> — Sirve carátulas y miniaturas del disco
router.get('/*', asyncHandler(async (req, res) => {
  const raw = decodeURIComponent(req.params[0] || '');
  if (!raw || raw.includes('\0')) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  // Resolve first, then validate: '..' segments are collapsed here, so the
  // root check below cannot be bypassed by encoding tricks.
  const resolvedPath = path.resolve('/', raw);

  if (!IMAGE_EXTENSIONS.has(path.extname(resolvedPath).toLowerCase())) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  const roots = await getAllowedImageRoots();
  if (!isInsideAllowedRoot(resolvedPath, roots)) {
    console.warn(`[images] ruta fuera de las bibliotecas rechazada: ${resolvedPath}`);
    return res.status(403).json({ error: 'Acceso denegado' });
  }

  try {
    await fs.promises.access(resolvedPath);
  } catch {
    return res.status(404).json({ error: 'Image not found' });
  }

  res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days
  res.sendFile(resolvedPath);
}));

module.exports = router;

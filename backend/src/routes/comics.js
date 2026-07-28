const express = require('express');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const {
  ensureExtracted,
  getPageFilePath,
  scanComicsLibrary,
  clearCache,
} = require('../services/comicReader');

const { asyncHandler } = require('../utils/asyncHandler');
const { getPagination, setPaginationHeaders } = require('../utils/pagination');

const { requireNumericParams } = require('../utils/params');

const router = express.Router();

// Los ids de ruta van directo a la base: validarlos acá evita un 500 por `/api/x/abc`.
requireNumericParams(router, 'id', 'libraryId');

// Comic pages are served one HTTP request per page, so keep the disk checks off
// the event loop.
async function fileExists(filePath) {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}



// ── GET /api/comics ───────────────────────────────────────────────────────────

router.get('/', asyncHandler(async (req, res) => {
  const { library_id, search } = req.query;
  const { limit, offset } = getPagination(req.query);

  const params = [];
  const conditions = [];

  if (library_id) {
    params.push(library_id);
    conditions.push(`library_id = $${params.length}`);
  }

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`title ILIKE $${params.length}`);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const [totalResult, result] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM comics ${where}`, params),
    pool.query(
      `SELECT * FROM comics ${where} ORDER BY title ASC, id ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
  ]);

  setPaginationHeaders(res, { total: totalResult.rows[0].total, offset, count: result.rows.length });
  res.json(result.rows);
}));

// ── GET /api/comics/:id ───────────────────────────────────────────────────────

router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query('SELECT * FROM comics WHERE id = $1', [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Comic no encontrado' });
  res.json(rows[0]);
}));

// ── GET /api/comics/:id/cover ─────────────────────────────────────────────────
// Returns the first page as the cover image.

router.get('/:id/cover', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query('SELECT * FROM comics WHERE id = $1', [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Comic no encontrado' });

  const comic = rows[0];

  if (!(await fileExists(comic.file_path))) {
    return res.status(404).json({ error: 'Archivo no encontrado en disco' });
  }

  if (comic.format === 'pdf') {
    // Serve the PDF file so the frontend can render cover via pdfjs
    return res.status(204).end(); // No cover image for PDF; frontend handles it
  }

  // Ensure extraction is done
  await ensureExtracted(comic.id, comic.file_path, comic.format);

  const pagePath = await getPageFilePath(comic.id, 0);
  if (!pagePath || !(await fileExists(pagePath))) {
    return res.status(404).json({ error: 'Portada no disponible' });
  }

  res.setHeader('Cache-Control', 'public, max-age=604800');
  res.sendFile(pagePath);
}));

// ── GET /api/comics/:id/page/:pageIndex ───────────────────────────────────────
// Serves a specific page image (0-indexed). For archive formats only.

router.get('/:id/page/:pageIndex', asyncHandler(async (req, res) => {
  const { id, pageIndex } = req.params;
  const idx = parseInt(pageIndex, 10);

  if (isNaN(idx) || idx < 0) {
    return res.status(400).json({ error: 'Índice de página inválido' });
  }

  const { rows } = await pool.query('SELECT * FROM comics WHERE id = $1', [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Comic no encontrado' });

  const comic = rows[0];

  if (comic.format === 'pdf') {
    return res.status(400).json({ error: 'Para PDF usa el endpoint /file' });
  }

  if (!(await fileExists(comic.file_path))) {
    return res.status(404).json({ error: 'Archivo no encontrado en disco' });
  }

  // Extract if not already cached
  const pageCount = await ensureExtracted(comic.id, comic.file_path, comic.format);

  // Update page_count in DB if it changed
  if (comic.page_count !== pageCount && pageCount > 0) {
    pool.query('UPDATE comics SET page_count = $1, updated_at = NOW() WHERE id = $2', [pageCount, id])
      .catch(() => {});
  }

  const pagePath = await getPageFilePath(comic.id, idx);
  if (!pagePath || !(await fileExists(pagePath))) {
    return res.status(404).json({ error: `Página ${idx} no encontrada` });
  }

  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(pagePath);
}));

// ── GET /api/comics/:id/file ──────────────────────────────────────────────────
// Streams the raw PDF file for frontend rendering.

router.get('/:id/file', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query('SELECT * FROM comics WHERE id = $1', [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Comic no encontrado' });

  const comic = rows[0];

  if (comic.format !== 'pdf') {
    return res.status(400).json({ error: 'Este endpoint es solo para PDF' });
  }

  if (!(await fileExists(comic.file_path))) {
    return res.status(404).json({ error: 'Archivo no encontrado en disco' });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(comic.file_path);
}));

// ── GET /api/comics/:id/info ──────────────────────────────────────────────────
// Returns page count, triggering extraction if needed.

router.get('/:id/info', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query('SELECT * FROM comics WHERE id = $1', [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Comic no encontrado' });

  const comic = rows[0];

  if (!(await fileExists(comic.file_path))) {
    return res.status(404).json({ error: 'Archivo no encontrado en disco' });
  }

  let pageCount = comic.page_count;

  if (pageCount === 0) {
    pageCount = await ensureExtracted(comic.id, comic.file_path, comic.format);
    if (pageCount > 0) {
      await pool.query('UPDATE comics SET page_count = $1, updated_at = NOW() WHERE id = $2', [pageCount, id]);
    }
  }

  res.json({ ...comic, page_count: pageCount });
}));

// ── POST /api/comics/scan-library/:libraryId ──────────────────────────────────
// Scans a comics library and upserts comics in the DB.

router.post('/scan-library/:libraryId', requireAdmin, asyncHandler(async (req, res) => {
  const { libraryId } = req.params;

  const libResult = await pool.query('SELECT * FROM libraries WHERE id = $1', [libraryId]);
  if (libResult.rows.length === 0) {
    return res.status(404).json({ error: 'Biblioteca no encontrada' });
  }

  // Get locations
  const locResult = await pool.query(
    'SELECT path FROM library_locations WHERE library_id = $1 ORDER BY position',
    [libraryId]
  );
  const library = {
    ...libResult.rows[0],
    locations: locResult.rows.length > 0
      ? locResult.rows.map(r => r.path)
      : [libResult.rows[0].path],
  };

  const { added, updated } = await scanComicsLibrary(library);

  await pool.query('UPDATE libraries SET last_scanned_at = CURRENT_TIMESTAMP WHERE id = $1', [libraryId]);

  res.json({
    message: `Escaneo completo: ${added} nuevos, ${updated} actualizados`,
    added,
    updated,
  });
}));

// ── DELETE /api/comics/:id ────────────────────────────────────────────────────

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query('SELECT id FROM comics WHERE id = $1', [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Comic no encontrado' });

  await clearCache(id);
  await pool.query('DELETE FROM comics WHERE id = $1', [id]);

  res.json({ message: 'Comic eliminado' });
}));

module.exports = router;

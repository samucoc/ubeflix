const express = require('express');
const { pool } = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAdmin } = require('../middleware/auth');
const torrents = require('../services/torrents');

const { requireNumericParams } = require('../utils/params');

const router = express.Router();

// Los ids de ruta van directo a la base: validarlos acá evita un 500 por `/api/x/abc`.
requireNumericParams(router, 'id');

// ─── GET /api/torrents/search?q=...&sources=yts,tpb ──────────────────────
router.get('/search', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Falta el término de búsqueda (q)' });

  const sources = (req.query.sources || 'yts,tpb')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const results = await torrents.searchTorrents(q, { sources });
  res.json({ query: q, count: results.length, results });
}));

// ─── GET /api/torrents — list all downloads ──────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const downloads = await torrents.listDownloads();
  res.json(downloads);
}));

// ─── POST /api/torrents/download — start a download (admin) ───────────────
// body: { magnet, libraryId, savePath, name, poster, quality, year, infoHash, source }
router.post('/download', requireAdmin, asyncHandler(async (req, res) => {
  const { magnet, libraryId, savePath, name, poster, quality, year, infoHash, source } = req.body;

  // Accept a magnet link or an http(s) .torrent URL.
  const isMagnet = magnet && /^magnet:\?/i.test(magnet);
  const isTorrentUrl = magnet && /^https?:\/\/.+/i.test(magnet);
  if (!isMagnet && !isTorrentUrl) {
    return res.status(400).json({ error: 'Se requiere un enlace magnet o una URL .torrent válida' });
  }
  if (!libraryId) {
    return res.status(400).json({ error: 'Elegí una biblioteca de destino' });
  }
  if (!savePath) {
    return res.status(400).json({ error: 'Elegí una ubicación de destino' });
  }

  // Validate: the library must be a movies library and savePath must be one
  // of its configured locations (prevents writing to arbitrary paths).
  const libResult = await pool.query('SELECT * FROM libraries WHERE id = $1', [libraryId]);
  if (libResult.rows.length === 0) {
    return res.status(404).json({ error: 'Biblioteca no encontrada' });
  }
  const library = libResult.rows[0];
  if (library.library_type !== 'movies') {
    return res.status(400).json({ error: 'La biblioteca de destino debe ser de tipo Películas' });
  }

  const locResult = await pool.query(
    'SELECT path FROM library_locations WHERE library_id = $1',
    [libraryId]
  );
  const validPaths = new Set(locResult.rows.map((r) => r.path));
  if (library.path) validPaths.add(library.path);
  if (!validPaths.has(savePath)) {
    return res.status(400).json({ error: 'La ubicación no pertenece a la biblioteca elegida' });
  }

  const download = await torrents.startDownload({
    magnet, savePath, libraryId, name: name || 'Torrent',
    poster, quality, year, infoHash, source,
  });

  res.status(201).json({ message: 'Descarga iniciada', download });
}));

// ─── POST /api/torrents/clear-completed — remove completed rows from the list ─
router.post('/clear-completed', requireAdmin, asyncHandler(async (req, res) => {
  const removed = await torrents.clearCompleted();
  res.json({ message: `Se quitaron ${removed} descarga(s) completada(s)`, removed });
}));

// ─── POST /api/torrents/:id/pause ────────────────────────────────────────
router.post('/:id/pause', requireAdmin, asyncHandler(async (req, res) => {
  const dl = await torrents.pauseDownload(parseInt(req.params.id, 10));
  if (!dl) return res.status(404).json({ error: 'Descarga no encontrada' });
  res.json(dl);
}));

// ─── POST /api/torrents/:id/resume ───────────────────────────────────────
router.post('/:id/resume', requireAdmin, asyncHandler(async (req, res) => {
  const dl = await torrents.resumeDownload(parseInt(req.params.id, 10));
  if (!dl) return res.status(404).json({ error: 'Descarga no encontrada' });
  res.json(dl);
}));

// ─── DELETE /api/torrents/:id?deleteFiles=true ───────────────────────────
router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const deleteFiles = req.query.deleteFiles === 'true';
  const ok = await torrents.removeDownload(parseInt(req.params.id, 10), { deleteFiles });
  if (!ok) return res.status(404).json({ error: 'Descarga no encontrada' });
  res.json({ message: deleteFiles ? 'Descarga y archivos eliminados' : 'Descarga eliminada de la lista' });
}));

module.exports = router;

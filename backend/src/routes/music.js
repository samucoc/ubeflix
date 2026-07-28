const express = require('express');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const { streamFileWithRange } = require('../utils/streamFile');
const { syncPlaylist, downloadPlaylistTracks, downloadTrackSafe } = require('../services/spotifySync');

const { asyncHandler } = require('../utils/asyncHandler');

const { requireNumericParams } = require('../utils/params');

const router = express.Router();

// Los ids de ruta van directo a la base: validarlos acá evita un 500 por `/api/x/abc`.
requireNumericParams(router, 'id', 'playlistId');

// ─── GET /api/music/playlists — List all synced playlists ─
router.get('/playlists', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.*,
      (SELECT COUNT(*) FROM spotify_tracks t WHERE t.playlist_id = p.id AND t.download_status = 'ready') as ready_count
     FROM spotify_playlists p ORDER BY p.updated_at DESC`
  );
  res.json(rows);
}));

// ─── GET /api/music/playlists/:id — Get playlist with tracks
router.get('/playlists/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const plRes = await pool.query('SELECT * FROM spotify_playlists WHERE id = $1', [id]);
  if (plRes.rows.length === 0) return res.status(404).json({ error: 'Playlist no encontrada' });

  const tracksRes = await pool.query(
    'SELECT * FROM spotify_tracks WHERE playlist_id = $1 ORDER BY id',
    [id]
  );

  res.json({ ...plRes.rows[0], tracks: tracksRes.rows });
}));

// ─── POST /api/music/sync — Sync a Spotify playlist (admin) ─
router.post('/sync', requireAdmin, async (req, res) => {
  try {
    const { playlist_url } = req.body;
    if (!playlist_url) return res.status(400).json({ error: 'playlist_url es requerido' });

    // Extract playlist ID from URL or raw ID
    let playlistId = playlist_url;
    const match = playlist_url.match(/playlist\/([a-zA-Z0-9]+)/);
    if (match) playlistId = match[1];

    if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
      return res.status(400).json({ error: 'Configura SPOTIFY_CLIENT_ID y SPOTIFY_CLIENT_SECRET en .env' });
    }

    const { playlistDbId, playlist } = await syncPlaylist(playlistId);

    res.json({
      message: `Playlist "${playlist.name}" sincronizada con ${playlist.track_count} tracks`,
      playlist_id: playlistDbId,
      name: playlist.name,
      track_count: playlist.track_count,
    });
  } catch (err) {
    console.error('Sync playlist error:', err);
    if (err.response?.status === 404) {
      return res.status(404).json({ error: 'Playlist no encontrada en Spotify' });
    }
    res.status(500).json({ error: 'Error al sincronizar: ' + err.message });
  }
});

// ─── POST /api/music/playlists/:id/resync — Re-sync playlist metadata+tracks from Spotify (admin) ─
router.post('/playlists/:id/resync', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const plRes = await pool.query('SELECT spotify_id FROM spotify_playlists WHERE id = $1', [id]);
  if (plRes.rows.length === 0) return res.status(404).json({ error: 'Playlist no encontrada' });

  const spotifyId = plRes.rows[0].spotify_id;
  const { playlistDbId, playlist } = await syncPlaylist(spotifyId);

  res.json({
    message: `Playlist "${playlist.name}" re-sincronizada con ${playlist.track_count} tracks`,
    playlist_id: playlistDbId,
    name: playlist.name,
    track_count: playlist.track_count,
  });
}));

// ─── POST /api/music/playlists/:id/download — Download all pending (admin) ─
router.post('/playlists/:id/download', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  res.json({ message: 'Descarga iniciada en segundo plano', playlist_id: id });

  // Run download in background
  downloadPlaylistTracks(parseInt(id)).then((results) => {
    console.log(`Playlist ${id} download complete:`, results);
  }).catch((err) => {
    console.error(`Playlist ${id} download error:`, err);
  });
}));

// ─── POST /api/music/tracks/:id/download — Download single track (admin) ─
router.post('/tracks/:id/download', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query('SELECT * FROM spotify_tracks WHERE id = $1', [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Track no encontrado' });

  const track = rows[0];
  if (track.download_status === 'ready') {
    return res.json({ message: 'Track ya descargado', status: 'ready' });
  }

  // Download in background
  res.json({ message: 'Descarga iniciada', status: 'downloading' });
  downloadTrackSafe(track).catch((err) => {
    console.error(`Track ${id} download error:`, err);
  });
}));

// ─── GET /api/music/tracks/:id/stream — Stream audio file ─
router.get('/tracks/:id/stream', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query('SELECT * FROM spotify_tracks WHERE id = $1', [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Track no encontrado' });

  const track = rows[0];
  if (track.download_status !== 'ready' || !track.file_path) {
    return res.status(404).json({ error: 'Track no disponible aún' });
  }

  const served = await streamFileWithRange(req, res, track.file_path, {
    contentType: 'audio/mpeg',
  });
  if (!served) {
    return res.status(404).json({ error: 'Archivo de audio no encontrado' });
  }
}));

// ─── DELETE /api/music/playlists/:id — Delete playlist (admin) ─
router.delete('/playlists/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Solo eliminar registros, no archivos (pueden ser usados por otras playlists)
  await pool.query('DELETE FROM spotify_tracks WHERE playlist_id = $1', [id]);
  await pool.query('DELETE FROM spotify_playlists WHERE id = $1', [id]);
  res.json({ message: 'Playlist eliminada' });
}));

// ─── PUT /api/music/playlists/:id — Edit playlist metadata (admin) ─
router.put('/playlists/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, description, image_url } = req.body;

  const existing = await pool.query('SELECT id FROM spotify_playlists WHERE id = $1', [id]);
  if (existing.rows.length === 0) return res.status(404).json({ error: 'Playlist no encontrada' });

  const fields = [];
  const values = [];
  let idx = 1;

  if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
  if (description !== undefined) { fields.push(`description = $${idx++}`); values.push(description); }
  if (image_url !== undefined) { fields.push(`image_url = $${idx++}`); values.push(image_url); }

  if (fields.length === 0) return res.status(400).json({ error: 'No hay campos para actualizar' });

  fields.push(`updated_at = NOW()`);
  values.push(id);

  await pool.query(
    `UPDATE spotify_playlists SET ${fields.join(', ')} WHERE id = $${idx}`,
    values
  );

  const updated = await pool.query('SELECT * FROM spotify_playlists WHERE id = $1', [id]);
  res.json(updated.rows[0]);
}));

// ─── GET /api/music/download-status/:playlistId — Check progress ─
router.get('/download-status/:playlistId', async (req, res) => {
  try {
    const { playlistId } = req.params;
    const { rows } = await pool.query(
      `SELECT download_status, COUNT(*) as count 
       FROM spotify_tracks WHERE playlist_id = $1 
       GROUP BY download_status`,
      [playlistId]
    );
    const status = {};
    for (const r of rows) status[r.download_status] = parseInt(r.count);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;

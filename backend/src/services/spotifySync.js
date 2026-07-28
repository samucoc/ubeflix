const axios = require('axios');
const { pool } = require('../config/db');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const MUSIC_PATH = process.env.MUSIC_PATH || '/music';

// ─── Spotify Auth (Client Credentials — auto-refresh cada ~1h) ───
let cachedToken = null;
let tokenExpiry = 0;

async function getSpotifyToken() {
  // Si el token cacheado aún es válido, reutilizar
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Configura SPOTIFY_CLIENT_ID y SPOTIFY_CLIENT_SECRET en .env');
  }

  console.log('[Spotify] Solicitando nuevo token...');
  const res = await axios.post(
    'https://accounts.spotify.com/api/token',
    'grant_type=client_credentials',
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
    }
  );

  cachedToken = res.data.access_token;
  // Renovar 2 min antes de que expire (Spotify da 3600s = 1h)
  tokenExpiry = Date.now() + (res.data.expires_in - 120) * 1000;
  console.log(`[Spotify] Token obtenido, expira en ${res.data.expires_in}s`);
  return cachedToken;
}

function spotifyApi() {
  return {
    async get(url) {
      const token = await getSpotifyToken();
      return axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
    },
  };
}

// ─── Helper: buscar una key en un objeto profundamente anidado ────
function findKeyDeep(obj, targetKey, maxDepth = 15) {
  if (maxDepth <= 0 || !obj || typeof obj !== 'object') return undefined;
  if (obj[targetKey] !== undefined) return obj[targetKey];
  for (const key of Object.keys(obj)) {
    const result = findKeyDeep(obj[key], targetKey, maxDepth - 1);
    if (result !== undefined) return result;
  }
  return undefined;
}

// ─── Helper: sleep con jitter para evitar rate limits ────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Fetch ALL track IDs via spclient protobuf (no rate limits) ────
async function fetchAllTrackIds(playlistId, embedToken) {
  try {
    const res = await axios.get(
      `https://spclient.wg.spotify.com/playlist/v2/playlist/${playlistId}`,
      {
        headers: { Authorization: `Bearer ${embedToken}` },
        responseType: 'arraybuffer',
        timeout: 15000,
      }
    );
    const buffer = Buffer.from(res.data);
    const text = buffer.toString('latin1');
    const trackIds = [];
    const trackRegex = /spotify:track:([a-zA-Z0-9]{22})/g;
    let m;
    while ((m = trackRegex.exec(text)) !== null) {
      if (!trackIds.includes(m[1])) trackIds.push(m[1]);
    }
    console.log(`[Spotify] spclient protobuf: ${trackIds.length} track IDs encontrados`);
    return trackIds;
  } catch (err) {
    console.log(`[Spotify] spclient fetch failed:`, err.response?.status || err.message);
    return null;
  }
}

// ─── Fetch track metadata from individual embed pages (batch) ────
async function fetchTrackMetadataBatch(trackIds, concurrency = 5) {
  const results = [];
  const re = /id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s;

  for (let i = 0; i < trackIds.length; i += concurrency) {
    const batch = trackIds.slice(i, i + concurrency);
    const promises = batch.map(async (trackId) => {
      try {
        const res = await axios.get(`https://open.spotify.com/embed/track/${trackId}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: 10000,
        });
        const match = res.data.match(re);
        if (!match) return null;
        const json = JSON.parse(match[1]);
        const entity = json?.props?.pageProps?.state?.data?.entity;
        if (!entity) return null;
        return {
          spotify_id: trackId,
          title: entity.title || entity.name || 'Unknown',
          artist: entity.artists?.map((a) => a.name).join(', ') || entity.subtitle || 'Unknown',
          album: '',
          duration_ms: entity.duration || 0,
          cover_url: entity.visualIdentity?.image?.[0]?.url || null,
          preview_url: entity.audioPreview?.url || null,
        };
      } catch {
        return null;
      }
    });
    const batchResults = await Promise.allSettled(promises);
    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
    }
    if (i + concurrency < trackIds.length) await sleep(500);
  }
  return results;
}

// ─── Fetch Playlist via Spotify Embed + paginación con token oculto ────
async function fetchPlaylist(playlistId) {
  // 1. Get playlist metadata via API (name, image, owner)
  let meta = {};
  try {
    const api = spotifyApi();
    const { data } = await api.get(`https://api.spotify.com/v1/playlists/${playlistId}?fields=name,description,images,owner(display_name),tracks(total)`);
    meta = {
      name: data.name,
      description: data.description || '',
      image_url: data.images?.[0]?.url || null,
      owner: data.owner?.display_name || 'Unknown',
      totalTracks: data.tracks?.total || 0,
    };
    console.log(`[Spotify] API metadata: "${meta.name}", ${meta.totalTracks} tracks totales`);
  } catch (err) {
    console.log('[Spotify] API metadata fetch failed, using embed only:', err.message);
  }

  // 2. Get tracks from embed page (primeros ~100)
  const embedRes = await axios.get(`https://open.spotify.com/embed/playlist/${playlistId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  const re = /id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s;
  const match = embedRes.data.match(re);

  if (!match) throw new Error('No se pudo extraer datos del embed de Spotify');

  const json = JSON.parse(match[1]);
  const entity = json?.props?.pageProps?.state?.data?.entity;

  if (!entity) throw new Error('Estructura de embed inesperada');

  const playlist = {
    spotify_id: playlistId,
    name: meta.name || entity.name || 'Playlist',
    description: meta.description || entity.subtitle || '',
    image_url: meta.image_url || entity.coverArt?.sources?.[0]?.url || null,
    owner: meta.owner || 'Unknown',
    tracks: [],
  };

  // Extraer primeros ~100 tracks del embed
  if (entity.trackList) {
    for (const t of entity.trackList) {
      const spotifyId = t.uri?.split(':').pop();
      if (!spotifyId) continue;

      playlist.tracks.push({
        spotify_id: spotifyId,
        title: t.title || 'Unknown',
        artist: t.subtitle || 'Unknown',
        album: '',
        duration_ms: t.duration || 0,
        cover_url: null,
        preview_url: t.audioPreview?.url || null,
      });
    }
  }

  console.log(`[Spotify] Embed: ${playlist.tracks.length} tracks de primera página`);

  // 3. Si el embed devolvió 100 tracks (su máximo), hay más → usar spclient + embed scraping
  const EMBED_TRACK_LIMIT = 100;
  const embedToken = findKeyDeep(json?.props?.pageProps, 'accessToken');

  if (playlist.tracks.length >= EMBED_TRACK_LIMIT && embedToken) {
    console.log(`[Spotify] Embed devolvió ${EMBED_TRACK_LIMIT} tracks (límite). Obteniendo IDs completos via spclient...`);

    // Get all track IDs from spclient protobuf (no rate limits)
    const allTrackIds = await fetchAllTrackIds(playlistId, embedToken);

    if (allTrackIds && allTrackIds.length > playlist.tracks.length) {
      // Find track IDs we don't have metadata for yet
      const existingIds = new Set(playlist.tracks.map((t) => t.spotify_id));
      const missingIds = allTrackIds.filter((id) => !existingIds.has(id));
      console.log(`[Spotify] Faltan ${missingIds.length} tracks. Obteniendo metadata via embed...`);

      // Fetch metadata for missing tracks from individual embed pages
      const extraTracks = await fetchTrackMetadataBatch(missingIds);
      console.log(`[Spotify] Metadata obtenida para ${extraTracks.length}/${missingIds.length} tracks adicionales`);
      playlist.tracks.push(...extraTracks);
    }
  } else if (playlist.tracks.length >= EMBED_TRACK_LIMIT) {
    console.log(`[Spotify] Embed devolvió ${EMBED_TRACK_LIMIT} tracks pero no se encontró token para paginar.`);
  }

  playlist.track_count = playlist.tracks.length;
  console.log(`[Spotify] Playlist "${playlist.name}" — ${playlist.track_count} tracks cargados`);
  return playlist;
}

// ─── Save playlist + tracks to DB ────────────────────────
async function savePlaylist(playlist) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert playlist
    const plRes = await client.query(
      `INSERT INTO spotify_playlists (spotify_id, name, description, image_url, owner, track_count, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6, CURRENT_TIMESTAMP)
       ON CONFLICT (spotify_id) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description,
         image_url = EXCLUDED.image_url, owner = EXCLUDED.owner,
         track_count = EXCLUDED.track_count, synced_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [playlist.spotify_id, playlist.name, playlist.description, playlist.image_url, playlist.owner, playlist.track_count]
    );
    const playlistDbId = plRes.rows[0].id;

    // Upsert tracks
    for (const track of playlist.tracks) {
      await client.query(
        `INSERT INTO spotify_tracks (spotify_id, playlist_id, title, artist, album, duration_ms, cover_url, preview_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (spotify_id) DO UPDATE SET
           playlist_id = EXCLUDED.playlist_id, title = EXCLUDED.title,
           artist = EXCLUDED.artist, album = EXCLUDED.album,
           duration_ms = EXCLUDED.duration_ms, cover_url = EXCLUDED.cover_url,
           preview_url = EXCLUDED.preview_url, updated_at = CURRENT_TIMESTAMP`,
        [track.spotify_id, playlistDbId, track.title, track.artist, track.album, track.duration_ms, track.cover_url, track.preview_url]
      );
    }

    await client.query('COMMIT');
    return playlistDbId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Configure spotdl with user's own Spotify credentials ─────
function initSpotdlConfig() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.log('[Music] No SPOTIFY_CLIENT_ID/SECRET in env, spotdl will use defaults');
    return;
  }
  const configDir = '/root/.config/spotdl';
  const configPath = path.join(configDir, 'config.json');
  try {
    let config = {};
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } else {
      fs.mkdirSync(configDir, { recursive: true });
    }
    config.client_id = clientId;
    config.client_secret = clientSecret;
    config.audio_providers = ['youtube'];
    config.yt_dlp_args = '--js-runtimes nodejs';
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
    console.log(`[Music] spotdl config updated: custom credentials + youtube provider`);
  } catch (err) {
    console.error('[Music] Failed to update spotdl config:', err.message);
  }
}

// ─── Download tracks via spotdl ──────────────────────────
const SPOTDL_TIMEOUT = 120000; // 2 minutos por track

async function downloadTrackSafe(track) {
  const safeArtist = track.artist.replace(/[<>:"/\\|?*]/g, '_');
  const safeTitle = track.title.replace(/[<>:"/\\|?*]/g, '_');
  const outDir = path.join(MUSIC_PATH, 'downloads');

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, `${safeArtist} - ${safeTitle}.mp3`);

  // Skip if already downloaded
  if (fs.existsSync(outFile)) {
    await pool.query(
      `UPDATE spotify_tracks SET file_path = $1, download_status = 'ready', updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [outFile, track.id]
    );
    return outFile;
  }

  const searchQuery = `ytsearch1:${track.artist} - ${track.title}`;

  await pool.query(
    `UPDATE spotify_tracks SET download_status = 'downloading', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [track.id]
  );

  const code = await new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', [
      searchQuery,
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--js-runtimes', 'node',
      '-o', outFile.replace('.mp3', '.%(ext)s'),
      '--no-playlist',
      '--no-warnings',
    ]);

    let stderr = '';
    let stdout = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (err) => reject(err));
    proc.on('close', (c) => resolve(c));

    // Timeout: kill process if it takes too long
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`yt-dlp timeout after ${SPOTDL_TIMEOUT / 1000}s`));
    }, SPOTDL_TIMEOUT);
    proc.on('close', () => clearTimeout(timer));
  }).catch(async (err) => {
    console.error(`[Music] yt-dlp error for "${track.artist} - ${track.title}":`, err.message);
    await pool.query(
      `UPDATE spotify_tracks SET download_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [track.id]
    );
    throw err;
  });

  if (code !== 0) {
    console.error(`[Music] yt-dlp exited with code ${code} for "${track.artist} - ${track.title}"`);
  }

  // Find the downloaded file
  if (code === 0 && fs.existsSync(outFile)) {
    await pool.query(
      `UPDATE spotify_tracks SET file_path = $1, download_status = 'ready', updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [outFile, track.id]
    );
    return outFile;
  }

  // Fuzzy match (yt-dlp may use slightly different filename)
  const files = fs.readdirSync(outDir).filter(f =>
    f.toLowerCase().includes(safeTitle.toLowerCase().slice(0, 20)) && f.endsWith('.mp3')
  );
  if (files.length > 0) {
    const foundFile = path.join(outDir, files[0]);
    await pool.query(
      `UPDATE spotify_tracks SET file_path = $1, download_status = 'ready', updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [foundFile, track.id]
    );
    return foundFile;
  }

  await pool.query(
    `UPDATE spotify_tracks SET download_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [track.id]
  );
  throw new Error('yt-dlp: file not found after download');
}

// ─── Download all pending tracks for a playlist (parallel) ──────────
const CONCURRENT_DOWNLOADS = 3;

async function downloadPlaylistTracks(playlistDbId) {
  // Reset any stuck 'downloading' for this playlist first
  await pool.query(
    `UPDATE spotify_tracks SET download_status = 'pending' WHERE playlist_id = $1 AND download_status = 'downloading'`,
    [playlistDbId]
  );

  const { rows: tracks } = await pool.query(
    `SELECT * FROM spotify_tracks WHERE playlist_id = $1 AND download_status IN ('pending','failed') ORDER BY id`,
    [playlistDbId]
  );

  const results = { success: 0, failed: 0, total: tracks.length };
  console.log(`[Music] Starting download of ${tracks.length} tracks (${CONCURRENT_DOWNLOADS} concurrent)`);

  // Process in batches of CONCURRENT_DOWNLOADS
  for (let i = 0; i < tracks.length; i += CONCURRENT_DOWNLOADS) {
    const batch = tracks.slice(i, i + CONCURRENT_DOWNLOADS);
    const settled = await Promise.allSettled(
      batch.map((track) =>
        downloadTrackSafe(track)
          .then(() => { results.success++; })
          .catch((err) => {
            console.error(`Failed to download "${track.artist} - ${track.title}":`, err.message);
            results.failed++;
          })
      )
    );
    console.log(`[Music] Batch ${Math.floor(i / CONCURRENT_DOWNLOADS) + 1}: ${results.success} ok, ${results.failed} failed / ${results.total} total`);
  }

  return results;
}

// ─── Full sync: fetch metadata + download ────────────────
async function syncPlaylist(spotifyPlaylistId) {
  const playlist = await fetchPlaylist(spotifyPlaylistId);
  const dbId = await savePlaylist(playlist);
  return { playlistDbId: dbId, playlist };
}

// ─── Reset stuck downloads (call on startup) ───────────
async function resetStuckDownloads() {
  try {
    const { rowCount } = await pool.query(
      `UPDATE spotify_tracks SET download_status = 'pending', updated_at = CURRENT_TIMESTAMP
       WHERE download_status = 'downloading'`
    );
    if (rowCount > 0) {
      console.log(`[Music] Reset ${rowCount} tracks stuck in 'downloading' → 'pending'`);
    }
  } catch (err) {
    console.error('[Music] Error resetting stuck downloads:', err.message);
  }
}

module.exports = {
  fetchPlaylist,
  savePlaylist,
  syncPlaylist,
  downloadTrackSafe,
  downloadPlaylistTracks,
  resetStuckDownloads,
  initSpotdlConfig,
};

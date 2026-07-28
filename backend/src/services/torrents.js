/**
 * Torrent search + download service.
 *
 * - Search: YTS (movie-focused, clean metadata) + apibay/ThePirateBay (general fallback).
 * - Download: embedded WebTorrent client (BitTorrent). Torrents download into a
 *   `torrents/` staging folder inside the chosen movie library; when complete the
 *   video file(s) are MOVED to the library root (next to the other movies) and the
 *   staging folder is cleaned up.
 * - Progress: persisted in DB (torrent_downloads) and broadcast via the shared
 *   progress service so the global ProgressToast can show it.
 * - On completion the target library is re-scanned so the movie shows up in Películas.
 */

const axios = require('axios');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { pool } = require('../config/db');
const progress = require('./progress');

// Torrents download into a stable staging area (a native ext4 Docker volume),
// NOT directly onto the library drive — external/USB drives mounted over 9p in
// WSL2 drop under sustained torrent I/O (ENODEV). The finished video is moved to
// the library location afterwards (a single sequential copy, with retries).
const STAGING_ROOT = process.env.DOWNLOADS_PATH || '/downloads';

// Video extensions we move to the library root once a torrent finishes.
const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm',
  '.m4v', '.mpg', '.mpeg', '.ts', '.vob', '.ogv', '.3gp',
]);

// Trackers appended to magnet links to improve peer discovery.
const YTS_TRACKERS = [
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:80',
  'udp://tracker.coppersurfer.tk:6969',
  'udp://glotorrents.pw:6969/announce',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://torrent.gresille.org:80/announce',
  'udp://p4p.arenabg.com:1337',
  'udp://tracker.leechers-paradise.org:6969',
];

const PUBLIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.bittor.pw:1337/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
];

// ─── DB schema (lazy, mirrors the pattern used in libraries.js) ──────────
let schemaReady = false;
async function ensureTorrentSchema() {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS torrent_downloads (
      id SERIAL PRIMARY KEY,
      name VARCHAR(500) NOT NULL,
      magnet TEXT NOT NULL,
      info_hash VARCHAR(64),
      library_id INTEGER REFERENCES libraries(id) ON DELETE SET NULL,
      save_path VARCHAR(500) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'queued',
      progress REAL NOT NULL DEFAULT 0,
      download_speed BIGINT NOT NULL DEFAULT 0,
      upload_speed BIGINT NOT NULL DEFAULT 0,
      downloaded BIGINT NOT NULL DEFAULT 0,
      total_size BIGINT NOT NULL DEFAULT 0,
      num_peers INTEGER NOT NULL DEFAULT 0,
      eta INTEGER,
      error TEXT,
      poster_url VARCHAR(500),
      quality VARCHAR(20),
      year INTEGER,
      source VARCHAR(20),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_torrent_downloads_status ON torrent_downloads(status)');
  // Migration: info_hash used to be stored as returned by the indexers (uppercase),
  // while WebTorrent always reports it lowercase — the stats poller matched on an
  // exact string and silently never found the row (progress stuck at 0%).
  await pool.query('UPDATE torrent_downloads SET info_hash = LOWER(info_hash) WHERE info_hash <> LOWER(info_hash)');
  schemaReady = true;
}

// Info hashes must always be compared/stored lowercase (see migration above).
function normHash(h) {
  return h ? String(h).trim().toLowerCase() : null;
}

// ─── WebTorrent client singleton (WebTorrent v2 is ESM-only) ─────────────
let clientPromise = null;
async function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { default: WebTorrent } = await import('webtorrent');
      // Disable uTP: the native utp-native addon segfaults (SIGSEGV) on Alpine/musl.
      // TCP + DHT + trackers + webseed are enough to download reliably.
      const client = new WebTorrent({ utp: false });
      client.on('error', (err) => {
        // Client-level errors (e.g. port issues) shouldn't crash the process.
        console.error('[Torrents] WebTorrent client error:', err.message);
      });
      console.log('[Torrents] WebTorrent client initialised');
      return client;
    })();
  }
  return clientPromise;
}

// ─── Magnet helpers ──────────────────────────────────────────────────────
function buildMagnet(infoHash, name, trackers) {
  const dn = encodeURIComponent(name || infoHash);
  const tr = trackers.map((t) => `&tr=${encodeURIComponent(t)}`).join('');
  return `magnet:?xt=urn:btih:${infoHash}&dn=${dn}${tr}`;
}

function humanSizeToBytes(str) {
  if (!str) return 0;
  const m = String(str).trim().match(/([\d.]+)\s*(TB|GB|MB|KB|B)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  const mult = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[unit] || 1;
  return Math.round(n * mult);
}

// ─── Search: YTS ─────────────────────────────────────────────────────────
async function searchYTS(query) {
  try {
    const { data } = await axios.get('https://yts.mx/api/v2/list_movies.json', {
      params: { query_term: query, limit: 20, sort_by: 'seeds' },
      timeout: 12000,
    });
    const movies = data?.data?.movies || [];
    const results = [];
    for (const movie of movies) {
      for (const t of movie.torrents || []) {
        const name = `${movie.title} (${movie.year}) [${t.quality}] [${t.type || 'web'}]`;
        results.push({
          source: 'yts',
          title: movie.title,
          name,
          year: movie.year,
          poster: movie.medium_cover_image || movie.large_cover_image || null,
          quality: t.quality,
          codec: t.video_codec,
          size: t.size,
          sizeBytes: t.size_bytes || humanSizeToBytes(t.size),
          seeds: t.seeds || 0,
          peers: t.peers || 0,
          infoHash: t.hash,
          magnet: buildMagnet(t.hash, name, YTS_TRACKERS),
          imdb: movie.imdb_code || null,
          rating: movie.rating || null,
        });
      }
    }
    return results;
  } catch (err) {
    console.error('[Torrents] YTS search failed:', err.message);
    return [];
  }
}

// ─── Search: apibay (ThePirateBay) ───────────────────────────────────────
// apibay quirks (learned the hard way):
//   • Spaces MUST be encoded as '+', not '%20', or multi-word queries return
//     "No results returned" (this is why the búsqueda failed for titles/years).
//   • The `cat=200` filter is buggy and drops valid results — search all
//     categories and filter to Video (200–299) client-side instead.
async function searchApibay(query) {
  try {
    // Build the query string manually so spaces become '+'.
    const q = query.trim().split(/\s+/).map(encodeURIComponent).join('+');
    const { data } = await axios.get(`https://apibay.org/q.php?q=${q}`, {
      timeout: 12000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (!Array.isArray(data)) return [];

    const all = [];
    for (const item of data) {
      // apibay returns a single placeholder row when there are no results.
      if (!item.info_hash || item.info_hash === '0000000000000000000000000000000000000000') continue;
      if (item.id === '0' && /no results/i.test(item.name || '')) continue;
      const seeds = parseInt(item.seeders, 10) || 0;
      const sizeBytes = parseInt(item.size, 10) || 0;
      const yearMatch = (item.name || '').match(/(19|20)\d{2}/);
      const category = parseInt(item.category, 10) || 0;
      all.push({
        source: 'tpb',
        title: item.name,
        name: item.name,
        year: yearMatch ? parseInt(yearMatch[0], 10) : null,
        poster: null,
        quality: detectQuality(item.name),
        codec: null,
        size: formatBytes(sizeBytes),
        sizeBytes,
        seeds,
        peers: parseInt(item.leechers, 10) || 0,
        infoHash: item.info_hash,
        magnet: buildMagnet(item.info_hash, item.name, PUBLIC_TRACKERS),
        imdb: item.imdb || null,
        rating: null,
        category,
      });
    }

    // Prefer Video-category results (200–299); if none, keep all (some are miscategorised).
    const video = all.filter((r) => r.category >= 200 && r.category < 300);
    return (video.length ? video : all).map(({ category, ...r }) => r);
  } catch (err) {
    console.error('[Torrents] apibay search failed:', err.message);
    return [];
  }
}

function detectQuality(name = '') {
  const m = name.match(/\b(2160p|1080p|720p|480p|4k)\b/i);
  return m ? m[0].toLowerCase() : null;
}

function formatBytes(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// ─── Combined search ─────────────────────────────────────────────────────
async function searchTorrents(query, { sources = ['yts', 'tpb'] } = {}) {
  const tasks = [];
  if (sources.includes('yts')) tasks.push(searchYTS(query));
  if (sources.includes('tpb')) tasks.push(searchApibay(query));
  const settled = await Promise.allSettled(tasks);
  const merged = [];
  for (const r of settled) if (r.status === 'fulfilled') merged.push(...r.value);
  // Sort by seeds desc so the healthiest torrents surface first.
  merged.sort((a, b) => (b.seeds || 0) - (a.seeds || 0));
  return merged;
}

// ─── Live stats cache (in-memory), keyed by DB download id ───────────────
const liveStats = new Map(); // id -> { progress, downloadSpeed, ... }

function mergeLive(row) {
  const live = liveStats.get(row.id);
  if (!live) return row;
  return { ...row, ...live };
}

// ─── Start a download ────────────────────────────────────────────────────
async function startDownload({ magnet, savePath, libraryId, name, poster, quality, year, infoHash, source }) {
  await ensureTorrentSchema();

  // save_path stores the library root (where the finished video is moved to).
  // Fail early with a clear message if the destination drive isn't reachable
  // inside the container (e.g. an external/USB drive not mounted in WSL2 → ENODEV).
  try {
    if (!fs.existsSync(savePath)) fs.mkdirSync(savePath, { recursive: true });
    fs.accessSync(savePath, fs.constants.W_OK);
    if (!fs.existsSync(STAGING_ROOT)) fs.mkdirSync(STAGING_ROOT, { recursive: true });
  } catch (err) {
    const code = err.code || '';
    const hint = (code === 'ENODEV' || code === 'ENOENT')
      ? 'La unidad no está montada en el contenedor (solo se ven las unidades montadas en /host). Suele pasar con discos externos/USB. Usá una carpeta en una unidad interna montada o montá esa unidad en Docker/WSL2.'
      : (code === 'EACCES' || code === 'EROFS')
      ? 'La carpeta existe pero no tiene permisos de escritura para el contenedor.'
      : err.message;
    throw new Error(`La carpeta de destino "${savePath}" no está accesible en el servidor. ${hint}`);
  }

  const insert = await pool.query(
    `INSERT INTO torrent_downloads
      (name, magnet, info_hash, library_id, save_path, status, poster_url, quality, year, source)
     VALUES ($1,$2,$3,$4,$5,'queued',$6,$7,$8,$9)
     RETURNING *`,
    [name, magnet, normHash(infoHash), libraryId || null, savePath, poster || null, quality || null, year || null, source || null]
  );
  const download = insert.rows[0];

  attachTorrent(download).catch((err) => {
    console.error(`[Torrents] Failed to start download ${download.id}:`, err.message);
    markError(download.id, err.message);
  });

  return download;
}

// ─── Attach a magnet to the WebTorrent client and wire up events ─────────
async function attachTorrent(download) {
  const client = await getClient();

  // Avoid duplicate torrents (WebTorrent throws on the same infoHash twice).
  // NOTE: in WebTorrent v2, client.get() returns a Promise.
  download.info_hash = normHash(download.info_hash);
  if (download.info_hash) {
    const existing = await client.get(download.info_hash);
    if (existing) {
      console.log(`[Torrents] Torrent already active for download ${download.id}`);
      return;
    }
  }

  await pool.query(
    `UPDATE torrent_downloads SET status='downloading', error=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
    [download.id]
  );
  progress.createTask(`torrent:${download.id}`, `⬇️ ${download.name}`, 100);

  // Download into a stable per-download staging folder (native volume).
  const stagingDir = path.join(STAGING_ROOT, String(download.id));
  try { if (!fs.existsSync(stagingDir)) fs.mkdirSync(stagingDir, { recursive: true }); } catch {}
  client.add(download.magnet, { path: stagingDir }, (torrent) => {
    console.log(`[Torrents] Download ${download.id} started: ${torrent.name} (${torrent.files.length} files) → ${stagingDir}`);

    // Backfill info_hash when the torrent was added via a .torrent URL (unknown up front).
    if (!download.info_hash && torrent.infoHash) {
      download.info_hash = normHash(torrent.infoHash);
      pool.query('UPDATE torrent_downloads SET info_hash=$1 WHERE id=$2', [download.info_hash, download.id]).catch(() => {});
    }

    let finalizing = false;
    const onDone = async () => {
      if (finalizing) return;
      finalizing = true;
      liveStats.set(download.id, {
        progress: 1,
        download_speed: 0,
        num_peers: torrent.numPeers,
        downloaded: torrent.downloaded,
        total_size: torrent.length,
      });
      progress.updateTask(`torrent:${download.id}`, 100, { label: `📦 Moviendo ${download.name} a la biblioteca...`, total: 100 });

      // Move the finished video file(s) from staging → library root, then clean up.
      let result = { moved: 0, total: 0 };
      try {
        result = await finalizeDownload(client, torrent, download, stagingDir);
      } catch (err) {
        console.error(`[Torrents] Finalize error for download ${download.id}:`, err.message);
      }

      const moveFailed = result.total > 0 && result.moved === 0;
      if (moveFailed) {
        const msg = 'Descarga completa, pero no se pudo mover el archivo a la biblioteca (la unidad de destino no está disponible). El archivo quedó en el área de descargas; reintentá cuando la unidad esté accesible.';
        await pool.query(
          `UPDATE torrent_downloads
             SET status='error', progress=1, download_speed=0, downloaded=$2, total_size=$3, error=$4, updated_at=CURRENT_TIMESTAMP
           WHERE id=$1`,
          [download.id, torrent.downloaded, torrent.length, msg]
        );
        progress.failTask(`torrent:${download.id}`, msg);
        console.error(`[Torrents] Download ${download.id}: ${msg}`);
        return;
      }

      await pool.query(
        `UPDATE torrent_downloads
           SET status='completed', progress=1, download_speed=0,
               downloaded=$2, total_size=$3, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
         WHERE id=$1`,
        [download.id, torrent.downloaded, torrent.length]
      );
      progress.completeTask(`torrent:${download.id}`, `✅ ${download.name} descargada`);
      console.log(`[Torrents] Download ${download.id} complete → scanning library ${download.library_id}`);
      await rescanLibrary(download.library_id);
    };

    if (torrent.done) {
      onDone();
    } else {
      torrent.on('done', onDone);
    }

    torrent.on('error', (err) => {
      console.error(`[Torrents] Torrent ${download.id} error:`, err.message);
      markError(download.id, err.message);
    });
  });
}

// ─── Move a file, retrying on transient errors (flaky USB/9p mounts) ─────
async function moveFile(src, dest, attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try {
      try {
        await fsp.rename(src, dest);
      } catch (err) {
        if (err.code === 'EXDEV') {
          // Cross-device (staging volume → library drive): copy then delete.
          await fsp.copyFile(src, dest);
          await fsp.unlink(src);
        } else {
          throw err;
        }
      }
      return;
    } catch (err) {
      const transient = ['ENODEV', 'EIO', 'EBUSY', 'EAGAIN', 'EPERM'].includes(err.code);
      if (i === attempts || !transient) throw err;
      console.warn(`[Torrents] move retry ${i}/${attempts} for ${path.basename(src)} (${err.code})`);
      try { if (fs.existsSync(dest)) await fsp.unlink(dest); } catch {}
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function finalizeDownload(client, torrent, download, stagingDir) {
  const libraryRoot = download.save_path;

  // Collect the video files to move to the library root.
  const videoFiles = [];
  for (const file of torrent.files) {
    const ext = path.extname(file.name).toLowerCase();
    if (VIDEO_EXTENSIONS.has(ext)) {
      // Skip tiny "sample" files.
      if (/sample/i.test(file.name) && file.length < 300 * 1024 * 1024) continue;
      videoFiles.push({ abs: path.join(stagingDir, file.path), name: file.name });
    }
  }

  // Release file handles before moving/deleting on disk.
  if (download.info_hash) {
    await client.remove(download.info_hash, { destroyStore: false }).catch(() => {});
  }

  // Move each video file to the library root.
  let moved = 0;
  for (const vf of videoFiles) {
    if (!fs.existsSync(vf.abs)) continue;
    const dest = path.join(libraryRoot, vf.name);
    try {
      if (fs.existsSync(dest)) {
        console.log(`[Torrents] Target already exists, leaving in place: ${dest}`);
        moved++; // count as handled so we don't flag a move failure
        continue;
      }
      await moveFile(vf.abs, dest);
      moved++;
      console.log(`[Torrents] Moved: ${vf.name} → ${libraryRoot}`);
    } catch (err) {
      console.error(`[Torrents] Failed to move ${vf.name}:`, err.code || err.message);
    }
  }

  // Clean the staging folder only if everything was moved out (otherwise keep the
  // files so a failed move to a flaky drive isn't lost).
  if (moved >= videoFiles.length) {
    try { await fsp.rm(stagingDir, { recursive: true, force: true }); } catch {}
  }

  console.log(`[Torrents] Finalized download ${download.id}: moved ${moved}/${videoFiles.length} video file(s)`);
  return { moved, total: videoFiles.length };
}

// ─── Re-scan the destination library so the new movie appears ────────────
async function rescanLibrary(libraryId) {
  if (!libraryId) return;
  try {
    const { scanLibrary } = require('./scanner');
    const libResult = await pool.query('SELECT * FROM libraries WHERE id = $1', [libraryId]);
    if (libResult.rows.length === 0) return;
    const library = libResult.rows[0];

    // Hydrate locations the same way the libraries route does.
    const locResult = await pool.query(
      'SELECT path FROM library_locations WHERE library_id = $1 ORDER BY position, id',
      [libraryId]
    );
    library.locations = locResult.rows.map((r) => r.path);
    if (library.locations.length === 0 && library.path) library.locations = [library.path];

    await scanLibrary(library);
    await pool.query('UPDATE libraries SET last_scanned_at = CURRENT_TIMESTAMP WHERE id = $1', [libraryId]);

    // Chain the same post-processing the Libraries page buttons do — thumbnails
    // and subtitles for the freshly-added movie. Fire-and-forget so the download
    // is already marked completed; progress shows in the global toast.
    postProcessLibrary(libraryId).catch((err) => {
      console.error(`[Torrents] Post-processing failed for library ${libraryId}:`, err.message);
    });
  } catch (err) {
    console.error(`[Torrents] Post-download scan failed for library ${libraryId}:`, err.message);
  }
}

// ─── Auto-generate thumbnails + fetch subtitles for new movies ───────────
async function postProcessLibrary(libraryId) {
  if (!libraryId) return;
  const subs = require('./subtitles');

  // 1. Thumbnails / posters (idempotent — only videos with a NULL thumbnail_path).
  try {
    const taskId = `torrent-thumbs:${libraryId}:${Date.now()}`;
    progress.createTask(taskId, '🖼️ Generando carátulas...', 1);
    const generated = await subs.generateLibraryThumbnails(libraryId);
    progress.completeTask(taskId, `🖼️ Carátulas generadas (${generated})`);
  } catch (err) {
    console.error('[Torrents] Thumbnail generation failed:', err.message);
  }

  // 2. Subtitles: embedded + external extraction, then OpenSubtitles fallback.
  try {
    const { rows: videos } = await pool.query(
      `SELECT v.id, v.file_path FROM videos v
         LEFT JOIN (SELECT video_id, COUNT(*) cnt FROM subtitles GROUP BY video_id) s ON s.video_id = v.id
        WHERE v.library_id = $1 AND (s.cnt IS NULL OR s.cnt = 0)`,
      [libraryId]
    );
    if (!videos.length) return;

    const hasOpenSub = !!process.env.OPENSUBTITLES_API_KEY;
    const taskId = `torrent-subs:${libraryId}:${Date.now()}`;
    progress.createTask(taskId, `💬 Buscando subtítulos (0/${videos.length})`, videos.length);

    let done = 0;
    let found = 0;
    for (const v of videos) {
      done++;
      if (fs.existsSync(v.file_path)) {
        try {
          const emb = await subs.extractEmbeddedSubtitles(v.id, v.file_path);
          const ext = await subs.findExternalSubtitles(v.id, v.file_path);
          let has = emb.length + ext.length > 0;
          if (!has && hasOpenSub) {
            const r = await subs.autoSearchOpenSubtitles(v.id);
            if (r && r.success && !r.skipped) has = true;
          }
          if (has) found++;
        } catch (err) {
          console.error(`[Torrents] Subtitle error for video ${v.id}:`, err.message);
        }
      }
      progress.updateTask(taskId, done, { label: `💬 Buscando subtítulos (${done}/${videos.length})` });
      // Respect OpenSubtitles rate limit (free tier ~5 req/s).
      if (done < videos.length && hasOpenSub) await new Promise((r) => setTimeout(r, 1500));
    }
    progress.completeTask(taskId, `💬 Subtítulos: ${found}/${videos.length}`);
  } catch (err) {
    console.error('[Torrents] Subtitle processing failed:', err.message);
  }
}

async function markError(id, message) {
  liveStats.delete(id);
  progress.failTask(`torrent:${id}`, message);
  await pool.query(
    `UPDATE torrent_downloads SET status='error', error=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
    [id, String(message).slice(0, 500)]
  ).catch(() => {});
}

// ─── Periodic stats poller ───────────────────────────────────────────────
let pollTimer = null;
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollActive, 2000);
}

async function pollActive() {
  let client;
  try {
    client = await getClient();
  } catch {
    return;
  }
  if (!client.torrents.length) return;

  for (const torrent of client.torrents) {
    // Find the matching DB row by info hash.
    let row;
    try {
      // LOWER() on both sides: indexers return uppercase hashes, WebTorrent lowercase.
      const r = await pool.query(
        `SELECT id FROM torrent_downloads WHERE LOWER(info_hash) = $1 AND status IN ('downloading','queued') ORDER BY id DESC LIMIT 1`,
        [normHash(torrent.infoHash)]
      );
      row = r.rows[0];
    } catch { continue; }
    if (!row) continue;

    const stats = {
      progress: torrent.progress,
      download_speed: Math.round(torrent.downloadSpeed),
      upload_speed: Math.round(torrent.uploadSpeed),
      downloaded: torrent.downloaded,
      total_size: torrent.length,
      num_peers: torrent.numPeers,
      eta: isFinite(torrent.timeRemaining) ? Math.round(torrent.timeRemaining / 1000) : null,
    };
    liveStats.set(row.id, stats);

    await pool.query(
      `UPDATE torrent_downloads
         SET progress=$2, download_speed=$3, upload_speed=$4, downloaded=$5,
             total_size=$6, num_peers=$7, eta=$8, updated_at=CURRENT_TIMESTAMP
       WHERE id=$1`,
      [row.id, stats.progress, stats.download_speed, stats.upload_speed, stats.downloaded, stats.total_size, stats.num_peers, stats.eta]
    ).catch(() => {});

    progress.updateTask(`torrent:${row.id}`, Math.round(torrent.progress * 100), {
      label: `⬇️ ${torrent.name || 'Torrent'} · ${formatBytes(stats.download_speed)}/s · ${stats.num_peers} peers`,
      total: 100,
    });
  }
}

// ─── List downloads (DB rows merged with live stats) ─────────────────────
async function listDownloads() {
  await ensureTorrentSchema();
  const { rows } = await pool.query(
    `SELECT d.*, l.name AS library_name
       FROM torrent_downloads d
       LEFT JOIN libraries l ON d.library_id = l.id
      ORDER BY d.created_at DESC`
  );
  return rows.map(mergeLive);
}

// ─── Pause / resume / remove ─────────────────────────────────────────────
async function pauseDownload(id) {
  const { rows } = await pool.query('SELECT * FROM torrent_downloads WHERE id=$1', [id]);
  if (!rows.length) return null;
  const dl = rows[0];
  dl.info_hash = normHash(dl.info_hash);
  const client = await getClient();
  const torrent = dl.info_hash ? await client.get(dl.info_hash) : null;
  if (torrent) await client.remove(dl.info_hash, { destroyStore: false }).catch(() => {});
  liveStats.delete(dl.id);
  progress.completeTask(`torrent:${dl.id}`, `⏸ ${dl.name}`);
  await pool.query(`UPDATE torrent_downloads SET status='paused', download_speed=0, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [id]);
  return { ...dl, status: 'paused' };
}

async function resumeDownload(id) {
  const { rows } = await pool.query('SELECT * FROM torrent_downloads WHERE id=$1', [id]);
  if (!rows.length) return null;
  const dl = rows[0];
  if (dl.status === 'completed') return dl;
  await attachTorrent(dl).catch((err) => markError(dl.id, err.message));
  return { ...dl, status: 'downloading' };
}

async function removeDownload(id, { deleteFiles = false } = {}) {
  const { rows } = await pool.query('SELECT * FROM torrent_downloads WHERE id=$1', [id]);
  if (!rows.length) return false;
  const dl = rows[0];
  dl.info_hash = normHash(dl.info_hash);
  const client = await getClient();
  const torrent = dl.info_hash ? await client.get(dl.info_hash) : null;
  if (torrent) {
    await client.remove(dl.info_hash, { destroyStore: deleteFiles }).catch(() => {});
  }
  // Always clean this download's staging folder from the volume.
  try { await fsp.rm(path.join(STAGING_ROOT, String(dl.id)), { recursive: true, force: true }); } catch {}
  liveStats.delete(dl.id);
  progress.completeTask(`torrent:${dl.id}`, `🗑 ${dl.name}`);
  await pool.query('DELETE FROM torrent_downloads WHERE id=$1', [id]);
  return true;
}

// ─── Clear completed downloads from the list (keeps the moved video files) ──
async function clearCompleted() {
  await ensureTorrentSchema();
  const { rows } = await pool.query(`SELECT id FROM torrent_downloads WHERE status = 'completed'`);
  for (const r of rows) {
    liveStats.delete(r.id);
    // Completed downloads already moved their video out; just tidy any staging remnants.
    try { await fsp.rm(path.join(STAGING_ROOT, String(r.id)), { recursive: true, force: true }); } catch {}
  }
  const res = await pool.query(`DELETE FROM torrent_downloads WHERE status = 'completed'`);
  return res.rowCount || 0;
}

// ─── Startup: reset stuck rows and resume unfinished downloads ───────────
async function resumeOnStartup() {
  try {
    await ensureTorrentSchema();
    startPolling();
    const { rows } = await pool.query(
      `SELECT * FROM torrent_downloads WHERE status IN ('downloading','queued')`
    );
    for (const dl of rows) {
      console.log(`[Torrents] Resuming download ${dl.id}: ${dl.name}`);
      attachTorrent(dl).catch((err) => markError(dl.id, err.message));
    }
  } catch (err) {
    console.error('[Torrents] resumeOnStartup failed:', err.message);
  }
}

module.exports = {
  ensureTorrentSchema,
  searchTorrents,
  startDownload,
  listDownloads,
  pauseDownload,
  resumeDownload,
  removeDownload,
  clearCompleted,
  resumeOnStartup,
  formatBytes,
};

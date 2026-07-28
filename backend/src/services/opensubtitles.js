/**
 * OpenSubtitles.com REST API client for searching and downloading subtitles.
 * API docs: https://opensubtitles.stoplight.io/docs/opensubtitles-api
 * 
 * Requires OPENSUBTITLES_API_KEY environment variable.
 * Free tier: 5 downloads/day (unauthenticated), 20/day (authenticated).
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { execSync } = require('child_process');
const axios = require('axios');
const unzipper = require('unzipper');
const { pool } = require('../config/db');
const { normalizeSubtitleFileInPlace } = require('./subtitleEncoding');

const SUBS_DIR = '/tmp/ubeflix-subs';
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.ssa', '.sub']);

const API_BASE = 'https://api.opensubtitles.com/api/v1';
const API_KEY = process.env.OPENSUBTITLES_API_KEY || '';
const OS_USER = process.env.OPENSUBTITLES_USER || '';
const OS_PASS = process.env.OPENSUBTITLES_PASS || '';

let authToken = null;
let tokenExpiry = 0;

// Ensure subs directory exists
try {
  if (!fs.existsSync(SUBS_DIR)) fs.mkdirSync(SUBS_DIR, { recursive: true });
} catch {}

/**
 * Get common headers for API requests
 */
function getHeaders(authenticated = false) {
  const headers = {
    'Api-Key': API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'ubeflix v1.0',
  };
  if (authenticated && authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  return headers;
}

/**
 * Login to OpenSubtitles (needed for downloads)
 */
async function login() {
  if (!API_KEY) {
    console.error('❌ OPENSUBTITLES_API_KEY not set');
    return false;
  }
  if (!OS_USER || !OS_PASS) {
    console.log('⚠️ OpenSubtitles user/pass not set — downloads will be limited');
    return false;
  }

  // Return cached token if still valid (tokens last 24h, refresh at 20h)
  if (authToken && Date.now() < tokenExpiry) {
    return true;
  }

  try {
    console.log('🔐 Logging in to OpenSubtitles...');
    const resp = await axios.post(`${API_BASE}/login`, {
      username: OS_USER,
      password: OS_PASS,
    }, {
      headers: getHeaders(),
      timeout: 15000,
    });

    if (resp.data?.token) {
      authToken = resp.data.token;
      // Token valid for 24h, refresh at 20h
      tokenExpiry = Date.now() + 20 * 60 * 60 * 1000;
      console.log('✅ OpenSubtitles login successful');
      console.log(`   Allowed downloads: ${resp.data.user?.allowed_downloads || 'unknown'}`);
      return true;
    }
  } catch (err) {
    console.error('❌ OpenSubtitles login failed:', err.response?.data?.message || err.message);
  }
  return false;
}

/**
 * Search for subtitles on OpenSubtitles
 * @param {string} query - Search query (movie/series title)
 * @param {Object} options - Additional search options
 * @returns {Array} Array of subtitle results
 */
async function searchOpenSubtitles(query, options = {}) {
  if (!API_KEY) {
    console.error('❌ OPENSUBTITLES_API_KEY not configured');
    return [];
  }

  try {
    console.log(`🔍 Searching OpenSubtitles for: "${query}"`);

    const params = {
      query: query,
      languages: 'es',
      order_by: 'download_count',
      order_direction: 'desc',
    };

    // Add optional filters
    if (options.season_number) params.season_number = options.season_number;
    if (options.episode_number) params.episode_number = options.episode_number;
    if (options.year) params.year = options.year;
    if (options.type) params.type = options.type; // 'movie' or 'episode'
    if (options.imdb_id) params.imdb_id = options.imdb_id;

    const resp = await axios.get(`${API_BASE}/subtitles`, {
      params,
      headers: getHeaders(),
      timeout: 15000,
    });

    const data = resp.data?.data || [];
    const results = data.slice(0, 20).map(item => ({
      id: String(item.id),
      file_id: item.attributes?.files?.[0]?.file_id || null,
      title: item.attributes?.feature_details?.title || item.attributes?.release || '',
      year: item.attributes?.feature_details?.year || null,
      release: item.attributes?.release || '',
      description: [
        item.attributes?.release || '',
        item.attributes?.comments || '',
        `⬇ ${item.attributes?.download_count || 0}`,
        `★ ${item.attributes?.ratings || 0}`,
      ].filter(Boolean).join(' | ').substring(0, 250),
      language: item.attributes?.language || 'es',
      format: item.attributes?.format || 'srt',
      download_count: item.attributes?.download_count || 0,
      fps: item.attributes?.fps || null,
      from_trusted: item.attributes?.from_trusted || false,
      ai_translated: item.attributes?.ai_translated || false,
      url: item.attributes?.url || '',
    }));

    console.log(`📋 Found ${results.length} subtitles for "${query}"`);
    return results;
  } catch (err) {
    if (err.response?.status === 401) {
      console.error('❌ OpenSubtitles: Invalid API key');
    } else if (err.response?.status === 429) {
      console.error('❌ OpenSubtitles: Rate limited, please wait');
    } else {
      console.error('OpenSubtitles search error:', err.response?.data?.message || err.message);
    }
    return [];
  }
}

/**
 * Download a subtitle file from OpenSubtitles
 * @param {number} fileId - The file_id from search results
 * @param {number} videoId - Our video ID to associate with
 * @returns {Object} Result with success/error
 */
async function downloadOpenSubtitles(fileId, videoId) {
  if (!API_KEY) {
    return { success: false, error: 'OPENSUBTITLES_API_KEY not configured' };
  }

  const videoSubDir = path.join(SUBS_DIR, String(videoId));
  if (!fs.existsSync(videoSubDir)) {
    fs.mkdirSync(videoSubDir, { recursive: true });
  }

  try {
    console.log(`📥 Downloading OpenSubtitles file ${fileId} for video ${videoId}`);

    // Login if not already
    await login();

    // Request download link
    const resp = await axios.post(`${API_BASE}/download`, {
      file_id: parseInt(fileId),
    }, {
      headers: getHeaders(true),
      timeout: 15000,
    });

    const downloadLink = resp.data?.link;
    const fileName = resp.data?.file_name || `sub_${fileId}.srt`;

    if (!downloadLink) {
      return { success: false, error: 'No download link received' };
    }

    const apiRemaining = resp.data?.remaining;
    console.log(`   Remaining downloads today: ${apiRemaining ?? 'unknown'}`);

    // Download the actual file
    const fileResp = await axios.get(downloadLink, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: { 'User-Agent': 'ubeflix v1.0' },
    });

    const buffer = Buffer.from(fileResp.data);
    if (buffer.length < 10) {
      return { success: false, error: 'Downloaded file is too small' };
    }

    const result = await processDownloadedSubtitle(buffer, fileId, videoId, videoSubDir, fileName);
    result.remaining = apiRemaining;
    return result;
  } catch (err) {
    if (err.response?.status === 406) {
      return { success: false, error: 'Límite de descargas diario alcanzado' };
    }
    if (err.response?.status === 429) {
      return { success: false, error: 'Rate limited — esperá un momento' };
    }
    console.error('OpenSubtitles download error:', err.response?.data?.message || err.message);
    return { success: false, error: err.response?.data?.message || err.message };
  }
}

/**
 * Process a downloaded subtitle file (can be SRT, VTT, ZIP, etc.)
 */
async function processDownloadedSubtitle(buffer, fileId, videoId, videoSubDir, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  const tempFile = path.join(videoSubDir, `download_${fileId}`);

  // Detect file type by magic bytes
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B;
  const isRar = buffer[0] === 0x52 && buffer[1] === 0x61 && buffer[2] === 0x72;

  let srtFiles = [];

  if (isZip) {
    const zipPath = tempFile + '.zip';
    fs.writeFileSync(zipPath, buffer);
    try {
      const directory = await unzipper.Open.file(zipPath);
      for (const file of directory.files) {
        const fileExt = path.extname(file.path).toLowerCase();
        if (SUBTITLE_EXTENSIONS.has(fileExt)) {
          const outName = `opensub_${fileId}_${path.basename(file.path)}`;
          const outPath = path.join(videoSubDir, outName);
          const content = await file.buffer();
          fs.writeFileSync(outPath, content);
          srtFiles.push(outPath);
        }
      }
    } catch (err) {
      console.error('ZIP extraction error:', err.message);
    }
    try { fs.unlinkSync(zipPath); } catch {}
  } else if (isRar) {
    const rarPath = tempFile + '.rar';
    fs.writeFileSync(rarPath, buffer);
    try {
      execSync(`7z e -y -o"${videoSubDir}" "${rarPath}"`, { timeout: 15000, stdio: 'pipe' });
      const extracted = fs.readdirSync(videoSubDir);
      for (const f of extracted) {
        const fileExt = path.extname(f).toLowerCase();
        if (SUBTITLE_EXTENSIONS.has(fileExt) && f !== path.basename(rarPath)) {
          srtFiles.push(path.join(videoSubDir, f));
        }
      }
    } catch {
      console.error('RAR extraction failed');
    }
    try { fs.unlinkSync(rarPath); } catch {}
  } else {
    // Direct subtitle file (SRT, VTT, etc.)
    const textContent = buffer.toString('utf8', 0, Math.min(buffer.length, 500));
    if (textContent.includes('-->') || textContent.includes('WEBVTT') ||
        textContent.includes('[Script Info]') || textContent.match(/^\d+\s*$/m)) {
      const outExt = ext && SUBTITLE_EXTENSIONS.has(ext) ? ext : '.srt';
      const srtPath = path.join(videoSubDir, `opensub_${fileId}${outExt}`);
      fs.writeFileSync(srtPath, buffer);
      srtFiles.push(srtPath);
    } else {
      console.log('Downloaded file is not a recognized subtitle format');
      return { success: false, error: 'Formato de subtítulo no reconocido' };
    }
  }

  // Convert to VTT and save to DB
  const added = [];
  for (const srtFile of srtFiles) {
    const fileExt = path.extname(srtFile).toLowerCase();
    let vttPath = srtFile;
    let format = fileExt.substring(1);

    if (fileExt === '.srt' || fileExt === '.vtt') {
      try { normalizeSubtitleFileInPlace(srtFile, fileExt === '.vtt' ? 'vtt' : 'srt'); } catch {}
    }

    if (['.srt', '.ass', '.ssa'].includes(fileExt)) {
      vttPath = srtFile.replace(/\.[^.]+$/, '.vtt');
      try {
        await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-i', srtFile, vttPath], { timeout: 15000 });
        format = 'vtt';
        if (vttPath !== srtFile) {
          try { fs.unlinkSync(srtFile); } catch {}
        }
      } catch {
        vttPath = srtFile;
      }
    }

    const existing = await pool.query(
      'SELECT id FROM subtitles WHERE video_id = $1 AND file_path = $2',
      [videoId, vttPath]
    );
    if (existing.rows.length === 0) {
      const result = await pool.query(
        `INSERT INTO subtitles (video_id, label, language, format, file_path, source, is_default)
         VALUES ($1, 'Español (OpenSubtitles)', 'es', $2, $3, 'opensubtitles', TRUE) RETURNING *`,
        [videoId, format, vttPath]
      );
      added.push(result.rows[0]);
    }
  }

  return { success: added.length > 0, subtitles: added };
}

/**
 * Auto-search and download subtitles for a video
 */
async function autoSearchOpenSubtitles(videoId) {
  // Get video info
  const videoResult = await pool.query(
    `SELECT v.id, v.title, v.year, v.original_filename, v.video_type,
            s.title as series_title, se.season_number, v.episode_number
     FROM videos v
     LEFT JOIN series s ON v.series_id = s.id
     LEFT JOIN seasons se ON v.season_id = se.id
     WHERE v.id = $1`,
    [videoId]
  );

  if (videoResult.rows.length === 0) return { success: false, error: 'Video not found' };
  const v = videoResult.rows[0];

  // Check if already has subtitles
  const existing = await pool.query('SELECT COUNT(*) as cnt FROM subtitles WHERE video_id = $1', [videoId]);
  if (parseInt(existing.rows[0].cnt) > 0) {
    return { success: true, skipped: true, message: 'Ya tiene subtítulos' };
  }

  // Build search query and options
  let searchQuery = '';
  const searchOptions = {};

  if (v.series_title) {
    searchQuery = v.series_title;
    searchOptions.type = 'episode';
    if (v.season_number) searchOptions.season_number = v.season_number;
    if (v.episode_number) searchOptions.episode_number = v.episode_number;
  } else {
    searchQuery = v.title || '';
    searchOptions.type = 'movie';
    if (v.year) searchOptions.year = v.year;
  }

  if (!searchQuery.trim()) {
    return { success: false, error: 'No se pudo construir la búsqueda' };
  }

  console.log(`🔍 Auto-search OpenSubtitles for video ${videoId}: "${searchQuery}"`);

  let results = await searchOpenSubtitles(searchQuery, searchOptions);

  // Filter out AI-translated subs (prefer human translations)
  const humanResults = results.filter(r => !r.ai_translated);
  if (humanResults.length > 0) results = humanResults;

  if (results.length === 0) {
    // Retry without year/episode filters
    if (v.year && !v.series_title) {
      const results2 = await searchOpenSubtitles(v.title, { type: 'movie' });
      const human2 = results2.filter(r => !r.ai_translated);
      results = human2.length > 0 ? human2 : results2;
    } else if (v.series_title && v.season_number && v.episode_number) {
      // Try with SxxExx format
      const sxxexx = `${v.series_title} S${String(v.season_number).padStart(2, '0')}E${String(v.episode_number).padStart(2, '0')}`;
      results = await searchOpenSubtitles(sxxexx);
    }
  }

  if (results.length === 0) {
    return { success: false, error: 'No se encontraron subtítulos' };
  }

  // Pick best result: prefer trusted, then highest download count
  const best = results.sort((a, b) => {
    if (a.from_trusted !== b.from_trusted) return b.from_trusted ? 1 : -1;
    return b.download_count - a.download_count;
  })[0];

  if (!best.file_id) {
    return { success: false, error: 'No file_id in result' };
  }

  return await downloadOpenSubtitles(best.file_id, videoId);
}

module.exports = {
  searchOpenSubtitles,
  downloadOpenSubtitles,
  autoSearchOpenSubtitles,
  login,
};

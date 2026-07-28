/**
 * SubDivX scraper using FlareSolverr to bypass Cloudflare protection.
 * FlareSolverr runs as a separate Docker container and solves Cloudflare challenges.
 */
const fs = require('fs');
const path = require('path');
const { execFile, execSync } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const axios = require('axios');
const cheerio = require('cheerio');
const unzipper = require('unzipper');
const { pool } = require('../config/db');
const { normalizeSubtitleFileInPlace } = require('./subtitleEncoding');

const SUBS_DIR = '/tmp/ubeflix-subs';
const SUBDIVX_BASE = 'https://www.subdivx.com';
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.ssa', '.sub']);
const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://flaresolverr:8191/v1';

const SUBDIVX_USER = process.env.SUBDIVX_USER || 'samu_co';
const SUBDIVX_PASS = process.env.SUBDIVX_PASS || 'solito';

// Cached session from FlareSolverr
let flareCookies = [];
let flareUserAgent = '';
let sessionId = null;

/**
 * Create a FlareSolverr session (persists browser between requests)
 */
async function createFlareSession() {
  if (sessionId) return sessionId;
  
  try {
    const resp = await axios.post(FLARESOLVERR_URL, {
      cmd: 'sessions.create',
    }, { timeout: 30000 });
    
    sessionId = resp.data.session;
    console.log('🔐 FlareSolverr session created:', sessionId);
    return sessionId;
  } catch (err) {
    console.error('FlareSolverr session create error:', err.message);
    return null;
  }
}

/**
 * Make a request through FlareSolverr (bypasses Cloudflare)
 */
async function flareRequest(url, options = {}) {
  const sid = await createFlareSession();
  
  const payload = {
    cmd: options.postData ? 'request.post' : 'request.get',
    url,
    maxTimeout: 60000,
    ...(sid && { session: sid }),
  };

  if (options.postData) {
    payload.postData = options.postData;
  }

  try {
    const resp = await axios.post(FLARESOLVERR_URL, payload, { timeout: 90000 });
    
    if (resp.data.status === 'ok') {
      // Cache cookies and user agent for direct requests
      flareCookies = resp.data.solution.cookies || [];
      flareUserAgent = resp.data.solution.userAgent || '';
      
      return {
        status: resp.data.solution.status,
        html: resp.data.solution.response,
        url: resp.data.solution.url,
        cookies: flareCookies,
        userAgent: flareUserAgent,
      };
    } else {
      console.error('FlareSolverr error:', resp.data.message);
      return null;
    }
  } catch (err) {
    // If session expired, reset and retry once
    if (err.response?.data?.message?.includes('session') || err.message.includes('session')) {
      sessionId = null;
      if (!options._retried) {
        return flareRequest(url, { ...options, _retried: true });
      }
    }
    console.error('FlareSolverr request error:', err.message);
    return null;
  }
}

/**
 * Build cookie string from FlareSolverr cookies
 */
function getCookieString() {
  return flareCookies.map(c => `${c.name}=${c.value}`).join('; ');
}

/**
 * Make a direct HTTP request using cookies from FlareSolverr
 * (for downloading files, API calls, etc.)
 */
async function directRequest(url, options = {}) {
  const headers = {
    'User-Agent': flareUserAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Cookie': getCookieString(),
    'Referer': SUBDIVX_BASE,
    ...(options.headers || {}),
  };

  return axios({
    url,
    method: options.method || 'get',
    headers,
    timeout: options.timeout || 30000,
    responseType: options.responseType || 'text',
    maxRedirects: 5,
  });
}

/**
 * Login to SubDivX (optional — search works without login on SubDivX)
 */
async function loginSubDivX() {
  console.log('🔐 Attempting SubDivX login via FlareSolverr...');
  
  // First, get the homepage to pass Cloudflare
  const homeResult = await flareRequest(SUBDIVX_BASE);
  if (!homeResult) {
    console.error('❌ Could not reach SubDivX through FlareSolverr');
    return false;
  }

  console.log('✅ SubDivX homepage loaded (Cloudflare bypassed)');

  // Try login via POST
  try {
    const loginResult = await flareRequest(`${SUBDIVX_BASE}/index.php`, {
      postData: `acession=login&usuario=${encodeURIComponent(SUBDIVX_USER)}&clave=${encodeURIComponent(SUBDIVX_PASS)}`,
    });
    
    if (loginResult) {
      if (loginResult.html.includes(SUBDIVX_USER) || loginResult.html.includes('Cerrar') || loginResult.html.includes('Mi cuenta')) {
        console.log('✅ Logged in to SubDivX');
        return true;
      }
    }
  } catch (err) {
    console.log('⚠️ Login attempt failed:', err.message);
  }

  // Search still works without login
  console.log('⚠️ Login status uncertain, proceeding anyway (search works without login)');
  return true;
}

/**
 * Search SubDivX for subtitles
 */
async function searchSubDivX(query) {
  try {
    console.log(`🔍 Searching SubDivX for: "${query}"`);

    // First, make sure we have valid Cloudflare cookies
    if (flareCookies.length === 0) {
      const homeResult = await flareRequest(SUBDIVX_BASE);
      if (!homeResult) {
        console.error('❌ Could not reach SubDivX');
        return [];
      }
    }

    // Try the AJAX search endpoint with cookies from FlareSolverr
    let results = [];
    
    try {
      const searchUrl = `${SUBDIVX_BASE}/inc/ajax.php?acession=buscar&buscar=${encodeURIComponent(query)}&oxession=1`;
      const resp = await directRequest(searchUrl);
      
      if (resp.status === 200 && resp.data) {
        results = parseSearchResults(resp.data);
      }
    } catch (err) {
      console.log('AJAX search failed, trying page search:', err.message);
    }

    // Fallback: load search page through FlareSolverr
    if (results.length === 0) {
      const searchUrl = `${SUBDIVX_BASE}/?buscar=${encodeURIComponent(query)}&acession=buscar`;
      const searchResult = await flareRequest(searchUrl);
      
      if (searchResult && searchResult.html) {
        results = parseSearchResults(searchResult.html);
      }
    }

    console.log(`📋 Found ${results.length} subtitles for "${query}"`);
    return results;
  } catch (err) {
    console.error('SubDivX search error:', err.message);
    return [];
  }
}

/**
 * Parse HTML/JSON search results from SubDivX
 */
function parseSearchResults(data) {
  const results = [];
  
  // Try JSON first
  try {
    const json = typeof data === 'string' ? JSON.parse(data) : data;
    if (json.results || json.aaData || Array.isArray(json)) {
      const items = json.results || json.aaData || json;
      for (const item of items.slice(0, 15)) {
        results.push({
          id: String(item.id || item.idsub || ''),
          title: item.titulo || item.title || '',
          description: (item.descripcion || item.description || '').substring(0, 200),
          detail: item.detalle || '',
          url: item.url || `${SUBDIVX_BASE}/X27-${item.id || item.idsub}`,
        });
      }
      return results;
    }
  } catch {}

  // Parse as HTML
  try {
    const $ = cheerio.load(data);
    
    // Modern SubDivX layout
    $('.titulo_menu_izq, .title_news_1').each((i, el) => {
      if (i >= 15) return false;
      const $el = $(el);
      const titleEl = $el.find('a').first();
      const title = titleEl.text().trim();
      const link = titleEl.attr('href') || '';
      const idMatch = link.match(/(\d+)$/);
      const id = idMatch ? idMatch[1] : null;
      const descEl = $el.next('.buscador_detalle_sub');
      const description = descEl ? descEl.text().trim().substring(0, 200) : '';

      if (id && title) {
        results.push({
          id,
          title,
          description,
          url: link.startsWith('http') ? link : `${SUBDIVX_BASE}${link}`,
        });
      }
    });

    // Alternative selectors
    if (results.length === 0) {
      $('a[href*="X27"]').each((i, el) => {
        if (i >= 15) return false;
        const href = $(el).attr('href') || '';
        const idMatch = href.match(/(\d+)$/);
        const id = idMatch ? idMatch[1] : null;
        const title = $(el).text().trim();
        if (id && title && title.length > 3) {
          results.push({
            id,
            title,
            description: '',
            url: href.startsWith('http') ? href : `${SUBDIVX_BASE}${href}`,
          });
        }
      });
    }
  } catch {}

  return results;
}

/**
 * Download subtitle from SubDivX
 */
async function downloadSubDivX(subdivxId, videoId) {
  const videoSubDir = path.join(SUBS_DIR, String(videoId));
  if (!fs.existsSync(videoSubDir)) {
    fs.mkdirSync(videoSubDir, { recursive: true });
  }

  try {
    console.log(`📥 Downloading SubDivX subtitle ${subdivxId} for video ${videoId}`);

    // Ensure we have cookies
    if (flareCookies.length === 0) {
      await flareRequest(SUBDIVX_BASE);
    }

    // Get the subtitle page to find download link
    let downloadUrl = null;
    
    try {
      const pageUrl = `${SUBDIVX_BASE}/X27-${subdivxId}`;
      const pageResp = await directRequest(pageUrl);
      
      if (pageResp.status === 200) {
        const $ = cheerio.load(pageResp.data);
        $('a').each((_, el) => {
          const href = $(el).attr('href') || '';
          if (href.includes('baession') || href.includes('download') || href.includes('/sub')) {
            downloadUrl = href.startsWith('http') ? href : `${SUBDIVX_BASE}${href}`;
            return false;
          }
        });
      }
    } catch (err) {
      console.log('Direct page load failed, trying FlareSolverr:', err.message);
      
      // Fallback: use FlareSolverr for the page
      const pageResult = await flareRequest(`${SUBDIVX_BASE}/X27-${subdivxId}`);
      if (pageResult) {
        const $ = cheerio.load(pageResult.html);
        $('a').each((_, el) => {
          const href = $(el).attr('href') || '';
          if (href.includes('baession') || href.includes('download') || href.includes('/sub')) {
            downloadUrl = href.startsWith('http') ? href : `${SUBDIVX_BASE}${href}`;
            return false;
          }
        });
      }
    }

    if (!downloadUrl) {
      downloadUrl = `${SUBDIVX_BASE}/sub${subdivxId}`;
    }

    // Download the subtitle file
    let buffer;
    try {
      const downloadResp = await directRequest(downloadUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });
      buffer = Buffer.from(downloadResp.data);
    } catch (err) {
      console.error('Direct download failed:', err.message);
      return { success: false, error: `Download failed: ${err.message}` };
    }

    if (!buffer || buffer.length < 10) {
      return { success: false, error: 'Downloaded file is too small or empty' };
    }

    return await processDownloadedSubtitle(buffer, subdivxId, videoId, videoSubDir);
  } catch (err) {
    console.error('SubDivX download error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Process a downloaded subtitle file (ZIP/RAR/SRT)
 */
async function processDownloadedSubtitle(buffer, subdivxId, videoId, videoSubDir) {
  const tempFile = path.join(videoSubDir, `download_${subdivxId}`);

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
        const ext = path.extname(file.path).toLowerCase();
        if (SUBTITLE_EXTENSIONS.has(ext)) {
          const outName = `subdivx_${subdivxId}_${path.basename(file.path)}`;
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
        const ext = path.extname(f).toLowerCase();
        if (SUBTITLE_EXTENSIONS.has(ext) && f !== path.basename(rarPath)) {
          srtFiles.push(path.join(videoSubDir, f));
        }
      }
    } catch {
      console.error('RAR extraction failed');
    }
    try { fs.unlinkSync(rarPath); } catch {}
  } else {
    // Check if it looks like text (SRT/VTT/ASS)
    const textContent = buffer.toString('utf8', 0, Math.min(buffer.length, 200));
    if (textContent.includes('-->') || textContent.includes('WEBVTT') || textContent.includes('[Script Info]') || textContent.match(/^\d+\s*$/m)) {
      const srtPath = tempFile + '.srt';
      fs.writeFileSync(srtPath, buffer);
      srtFiles.push(srtPath);
    } else {
      console.log('Downloaded file does not appear to be a subtitle. First bytes:', buffer.slice(0, 20).toString('hex'));
      return { success: false, error: 'Downloaded file is not a recognized subtitle format' };
    }
  }

  // Convert to VTT and save to DB
  const added = [];
  for (const srtFile of srtFiles) {
    const ext = path.extname(srtFile).toLowerCase();
    let vttPath = srtFile;
    let format = ext.substring(1);

    if (ext === '.srt' || ext === '.vtt') {
      try { normalizeSubtitleFileInPlace(srtFile, ext === '.vtt' ? 'vtt' : 'srt'); } catch {}
    }

    if (['.srt', '.ass', '.ssa'].includes(ext)) {
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
         VALUES ($1, 'Español (SubDivX)', 'es', $2, $3, 'subdivx', TRUE) RETURNING *`,
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
async function autoSearchSubDivX(videoId) {
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
    return { success: true, skipped: true, message: 'Already has subtitles' };
  }

  // Build search query
  let searchQuery = '';
  if (v.series_title) {
    searchQuery = v.series_title;
    if (v.season_number && v.episode_number) {
      searchQuery += ` S${String(v.season_number).padStart(2, '0')}E${String(v.episode_number).padStart(2, '0')}`;
    }
  } else {
    searchQuery = v.title || '';
    if (v.year) searchQuery += ` ${v.year}`;
  }

  if (!searchQuery.trim()) {
    return { success: false, error: 'No search query could be built' };
  }

  console.log(`🔍 Auto-searching SubDivX for video ${videoId}: "${searchQuery}"`);

  const results = await searchSubDivX(searchQuery);
  if (results.length === 0) {
    // Try without year
    if (v.year && !v.series_title) {
      const results2 = await searchSubDivX(v.title);
      if (results2.length > 0) {
        return await downloadSubDivX(results2[0].id, videoId);
      }
    }
    return { success: false, error: 'No results found' };
  }

  // Download first result (best match)
  return await downloadSubDivX(results[0].id, videoId);
}

/**
 * Destroy the FlareSolverr session
 */
async function closeBrowser() {
  if (sessionId) {
    try {
      await axios.post(FLARESOLVERR_URL, {
        cmd: 'sessions.destroy',
        session: sessionId,
      }, { timeout: 10000 });
    } catch {}
    sessionId = null;
    flareCookies = [];
  }
}

module.exports = {
  searchSubDivX,
  downloadSubDivX,
  autoSearchSubDivX,
  loginSubDivX,
  closeBrowser,
};

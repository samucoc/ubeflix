const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const unzipper = require('unzipper');

const CACHE_BASE = process.env.COMICS_CACHE_DIR || path.join(os.tmpdir(), 'ubeflix-comics');
const COMIC_EXTENSIONS = new Set(['.pdf', '.zip', '.rar', '.cbr', '.cbz']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff']);

function isImageFile(filename) {
  return IMAGE_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

function naturalSort(a, b) {
  const aBase = path.basename(a).toLowerCase();
  const bBase = path.basename(b).toLowerCase();
  return aBase.localeCompare(bBase, undefined, { numeric: true, sensitivity: 'base' });
}

function comicCacheDir(comicId) {
  return path.join(CACHE_BASE, String(comicId));
}

async function ensureCacheDir(comicId) {
  const dir = comicCacheDir(comicId);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

async function isCached(comicId) {
  const dir = comicCacheDir(comicId);
  try {
    const files = await fsp.readdir(dir);
    return files.some(f => f.startsWith('page_'));
  } catch {
    return false;
  }
}

async function getCachedPages(comicId) {
  const dir = comicCacheDir(comicId);
  try {
    const files = await fsp.readdir(dir);
    return files
      .filter(f => f.startsWith('page_') && IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
      .sort()
      .map(f => path.join(dir, f));
  } catch {
    return [];
  }
}

// ── ZIP / CBZ extraction ──────────────────────────────────────────────────────

async function extractZip(comicId, filePath) {
  const cacheDir = await ensureCacheDir(comicId);

  const directory = await unzipper.Open.file(filePath);

  const imageFiles = directory.files
    .filter(f => f.type === 'File' && isImageFile(f.path) && !f.path.includes('__MACOSX'))
    .sort((a, b) => naturalSort(a.path, b.path));

  for (let i = 0; i < imageFiles.length; i++) {
    const ext = path.extname(imageFiles[i].path).toLowerCase() || '.jpg';
    const outPath = path.join(cacheDir, `page_${String(i).padStart(5, '0')}${ext}`);
    const content = await imageFiles[i].buffer();
    await fsp.writeFile(outPath, content);
  }

  return imageFiles.length;
}

// ── RAR / CBR extraction ─────────────────────────────────────────────────────

async function extractRar(comicId, filePath) {
  const { createExtractorFromData } = require('node-unrar-js');
  const cacheDir = await ensureCacheDir(comicId);

  const fileContent = await fsp.readFile(filePath);
  // Convert Buffer to a clean ArrayBuffer
  const arrayBuffer = fileContent.buffer.slice(
    fileContent.byteOffset,
    fileContent.byteOffset + fileContent.byteLength
  );

  const extractor = await createExtractorFromData({ data: arrayBuffer });

  const list = extractor.getFileList();
  const allHeaders = [...list.fileHeaders];
  const imageHeaders = allHeaders
    .filter(h => !h.flags.directory && isImageFile(h.name))
    .sort((a, b) => naturalSort(a.name, b.name));

  if (imageHeaders.length === 0) return 0;

  const extracted = extractor.extract({ files: imageHeaders.map(h => h.name) });

  // Build name → content map
  const contentMap = new Map();
  for (const file of extracted.files) {
    if (file.extraction) {
      contentMap.set(file.fileHeader.name, file.extraction);
    }
  }

  // Write in sorted order
  let written = 0;
  for (let i = 0; i < imageHeaders.length; i++) {
    const content = contentMap.get(imageHeaders[i].name);
    if (!content) continue;
    const ext = path.extname(imageHeaders[i].name).toLowerCase() || '.jpg';
    const outPath = path.join(cacheDir, `page_${String(written).padStart(5, '0')}${ext}`);
    await fsp.writeFile(outPath, Buffer.from(content));
    written++;
  }

  return written;
}

// ── PDF page count ────────────────────────────────────────────────────────────

async function getPdfPageCount(filePath) {
  const pdfParse = require('pdf-parse');
  try {
    const dataBuffer = await fsp.readFile(filePath);
    const data = await pdfParse(dataBuffer, { max: 1 }); // max:1 to skip text extraction
    return data.numpages;
  } catch (err) {
    console.error('PDF parse error:', err.message);
    return 0;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Ensure pages are extracted to cache. Returns page count.
 */
async function ensureExtracted(comicId, filePath, format) {
  if (format === 'pdf') {
    return getPdfPageCount(filePath);
  }

  if (await isCached(comicId)) {
    const pages = await getCachedPages(comicId);
    return pages.length;
  }

  if (format === 'zip' || format === 'cbz') {
    return extractZip(comicId, filePath);
  }

  if (format === 'rar' || format === 'cbr') {
    return extractRar(comicId, filePath);
  }

  return 0;
}

/**
 * Get the filesystem path for a specific page (0-indexed).
 * Returns null if not available (use for image-based formats only).
 */
async function getPageFilePath(comicId, pageIndex) {
  const pages = await getCachedPages(comicId);
  if (pageIndex < 0 || pageIndex >= pages.length) return null;
  return pages[pageIndex];
}

/**
 * Scan a directory for comic files.
 */
async function scanComicsDir(dirPath) {
  const found = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (COMIC_EXTENSIONS.has(ext)) {
          found.push({ filePath: fullPath, format: ext.slice(1) });
        }
      }
    }
  }

  await walk(dirPath);
  return found;
}

/**
 * Clear cached pages for a comic (e.g., if file was updated).
 */
async function clearCache(comicId) {
  const dir = comicCacheDir(comicId);
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore
  }
}

/**
 * Scan a library (all its locations) for comics and upsert into the DB.
 */
async function scanComicsLibrary(library) {
  const { pool } = require('../config/db');

  const locations = Array.isArray(library.locations) && library.locations.length > 0
    ? library.locations
    : [library.path];

  let added = 0;
  let updated = 0;

  for (const location of locations) {
    if (!fs.existsSync(location)) continue;

    const found = await scanComicsDir(location);

    for (const { filePath, format } of found) {
      try {
        const stat = await fsp.stat(filePath);
        const title = path.basename(filePath, path.extname(filePath))
          .replace(/[_\-\.]+/g, ' ')
          .trim();

        const existing = await pool.query('SELECT id FROM comics WHERE file_path = $1', [filePath]);

        if (existing.rows.length > 0) {
          await pool.query(
            'UPDATE comics SET title = $1, file_size = $2, library_id = $3, updated_at = NOW() WHERE file_path = $4',
            [title, stat.size, library.id, filePath]
          );
          updated++;
        } else {
          await pool.query(
            'INSERT INTO comics (title, file_path, format, file_size, library_id) VALUES ($1, $2, $3, $4, $5)',
            [title, filePath, format, stat.size, library.id]
          );
          added++;
        }
      } catch (fileErr) {
        console.error(`Error processing comic ${filePath}:`, fileErr.message);
      }
    }
  }

  console.log(`[comics] Library ${library.id} scanned: ${added} new, ${updated} updated`);
  return { added, updated };
}

module.exports = {
  COMIC_EXTENSIONS,
  ensureExtracted,
  getPageFilePath,
  getCachedPages,
  scanComicsDir,
  scanComicsLibrary,
  clearCache,
  comicCacheDir,
};

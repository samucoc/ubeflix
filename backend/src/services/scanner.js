const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

// Common video extensions
const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm',
  '.m4v', '.mpg', '.mpeg', '.ts', '.vob', '.ogv', '.3gp',
]);

// Image extensions for posters/banners
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

// Parse series folder structure
// Expected: /SeriesName/Season 01/Episode01.mkv
// Or:       /SeriesName/S01E01 - Episode Title.mkv
// Or:       /SeriesName/Season 1/S01E01.mkv
// Or:       /SeriesName/SubFolder/Episode01.mkv  (subfolder as season)
function extractSeriesTitleFromFilename(filename) {
  const patterns = [
    /(.*?)[\s._-]*[Ss](\d+)[Ee](\d+)(.*)/,
    /(.*?)[\s._-]*(\d+)x(\d+)(.*)/i,
    /(.*?)[\s._-]*(?:episode|episodio|ep|e)\s*(\d+)(.*)/i,
  ];

  for (const pattern of patterns) {
    const match = filename.match(pattern);
    if (match) {
      const title = cleanTitle(match[1]);
      if (title) return title;
    }
  }

  return '';
}

function parseSeriesInfo(filePath, libraryPath) {
  const relative = path.relative(libraryPath, filePath);
  const parts = relative.split(path.sep);
  const filename = path.basename(filePath, path.extname(filePath));
  const hasSeriesFolder = parts.length >= 2;
  const seriesFolder = hasSeriesFolder ? parts[0] : null;
  const seriesTitle = hasSeriesFolder
    ? cleanTitle(seriesFolder)
    : extractSeriesTitleFromFilename(filename);

  if (!seriesTitle) return null;

  let seasonNumber = 1;
  let episodeNumber = null;
  let episodeTitle = '';
  let seasonFolder = null;
  let subfolderName = null;

  // Check if there's a season/subfolder
  if (parts.length >= 3) {
    seasonFolder = parts[1];
    subfolderName = parts[1];
    // Match "Season 2", "Temporada 3", or strict "S01" prefix (at word boundary, digits immediately after)
    const seasonMatch = seasonFolder.match(/\b(?:season|temporada)\s*(\d+)/i) || seasonFolder.match(/\bs(\d+)/i);
    if (seasonMatch) {
      seasonNumber = parseInt(seasonMatch[1]);
    } else {
      // Subfolder that isn't a standard season folder — treat as season 1
      // but keep the subfolder name for grouping
      seasonNumber = 1;
    }
  }

  // Parse episode info from filename
  // Try S01E01 format
  const seMatch = filename.match(/[Ss](\d+)[Ee](\d+)/);
  if (seMatch) {
    seasonNumber = parseInt(seMatch[1]);
    episodeNumber = parseInt(seMatch[2]);
    // Get title after the pattern
    const afterPattern = filename.substring(filename.indexOf(seMatch[0]) + seMatch[0].length);
    episodeTitle = cleanTitle(afterPattern) || `Episodio ${episodeNumber}`;
  }

  // Try "1x01" format
  if (!episodeNumber) {
    const xMatch = filename.match(/(\d+)x(\d+)/i);
    if (xMatch) {
      seasonNumber = parseInt(xMatch[1]);
      episodeNumber = parseInt(xMatch[2]);
      const afterPattern = filename.substring(filename.indexOf(xMatch[0]) + xMatch[0].length);
      episodeTitle = cleanTitle(afterPattern) || `Episodio ${episodeNumber}`;
    }
  }

  // Try "Episode 01" or "E01" format
  if (!episodeNumber) {
    const epMatch = filename.match(/(?:episode|episodio|ep|e)\s*(\d+)/i);
    if (epMatch) {
      episodeNumber = parseInt(epMatch[1]);
      const afterPattern = filename.substring(filename.indexOf(epMatch[0]) + epMatch[0].length);
      episodeTitle = cleanTitle(afterPattern) || `Episodio ${episodeNumber}`;
    }
  }

  // Try just a number at the start or end
  if (!episodeNumber) {
    const numMatch = filename.match(/^(\d+)\s*[-.]?\s*(.*)/) || filename.match(/(.*?)\s*[-.]?\s*(\d+)$/);
    if (numMatch) {
      episodeNumber = parseInt(numMatch[1]) || parseInt(numMatch[2]);
      episodeTitle = cleanTitle(numMatch[2] || numMatch[1]) || `Episodio ${episodeNumber}`;
    }
  }

  if (!episodeNumber) {
    episodeNumber = 1;
    episodeTitle = cleanTitle(filename);
  }

  return {
    seriesTitle,
    seriesFolder,
    seasonNumber,
    seasonFolder,
    subfolderName,
    episodeNumber,
    episodeTitle: episodeTitle || `Episodio ${episodeNumber}`,
  };
}

// Parse movie info from filename
function parseMovieInfo(filePath) {
  const filename = path.basename(filePath, path.extname(filePath));
  let title = filename;
  let year = null;

  // Try to extract year (1900-2099)
  const yearMatch = filename.match(/[\(\[\s]*((?:19|20)\d{2})[\)\]\s]*/);
  if (yearMatch) {
    year = parseInt(yearMatch[1]);
    title = filename.substring(0, filename.indexOf(yearMatch[0]));
  }

  // Clean up common tags
  title = title
    .replace(/\b(720p|1080p|2160p|4k|uhd|hdr|bluray|bdrip|brrip|dvdrip|webrip|web-dl|hdtv|x264|x265|h264|h265|aac|ac3|dts|5\.1|7\.1|remux|proper|repack)\b/gi, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '');

  title = cleanTitle(title);

  return { title: title || cleanTitle(filename), year };
}

function cleanTitle(name) {
  if (!name) return '';
  return name
    .replace(/[._]/g, ' ')
    .replace(/[-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Find images in a directory (poster, banner, thumb, etc.)
function findImages(dirPath) {
  const images = { poster: null, banner: null };
  try {
    if (!fs.existsSync(dirPath)) return images;
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) continue;
      const name = path.basename(file, ext).toLowerCase();
      if (['poster', 'cover', 'folder', 'show'].includes(name)) {
        images.poster = path.join(dirPath, file);
      } else if (['banner', 'backdrop', 'fanart', 'background'].includes(name)) {
        images.banner = path.join(dirPath, file);
      } else if (!images.poster) {
        images.poster = path.join(dirPath, file);
      }
    }
  } catch (err) {
    console.error('Error finding images:', err.message);
  }
  return images;
}

// Recursively find all video files
function findVideoFiles(dirPath) {
  const videos = [];

  function walk(currentPath) {
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          // Skip hidden folders, extras, etc.
          if (entry.name.startsWith('.') || ['extras', 'featurettes', 'behind the scenes', 'trailers', 'subs', 'subtitles', 'torrents'].includes(entry.name.toLowerCase())) {
            continue;
          }
          walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (VIDEO_EXTENSIONS.has(ext)) {
            // Skip sample files
            if (entry.name.toLowerCase().includes('sample') && entry.name.length < 20) continue;
            videos.push(fullPath);
          }
        }
      }
    } catch (err) {
      console.error(`Error reading directory ${currentPath}:`, err.message);
    }
  }

  walk(dirPath);
  return videos;
}

// Get file size
function getFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

// Main scan function
async function scanLibrary(library) {
  const locations = Array.isArray(library.locations) && library.locations.length > 0
    ? [...new Set(library.locations.map((p) => String(p).trim()).filter(Boolean))]
    : (library.path ? [library.path] : []);

  console.log(`📁 Scanning library: ${library.name} (${library.library_type}) on ${locations.length} location(s)`);

  if (locations.length === 0) {
    console.error('Library has no configured locations');
    return { error: 'No locations configured', scanned: 0 };
  }

  const scannedFiles = [];
  for (const location of locations) {
    if (!fs.existsSync(location)) {
      console.warn(`Library location does not exist, skipping: ${location}`);
      continue;
    }

    const files = findVideoFiles(location);
    console.log(`  • ${location}: ${files.length} video(s)`);
    for (const filePath of files) {
      scannedFiles.push({ filePath, rootPath: location });
    }
  }

  const videoFiles = scannedFiles.map((entry) => entry.filePath);
  console.log(`Found ${videoFiles.length} video files on disk in total`);

  // Build a set of current file paths on disk for fast lookup
  const diskPaths = new Set(videoFiles);

  let added = 0;
  let removed = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  if (library.library_type === 'series') {
    const result = await scanSeriesLibrary(library, scannedFiles, diskPaths);
    added = result.added;
    removed = result.removed;
    updated = result.updated;
    skipped = result.skipped;
  } else {
    // === MOVIES ===

    // 1. Remove videos whose files no longer exist on disk
    const existingVideos = await pool.query(
      'SELECT id, file_path, title FROM videos WHERE library_id = $1',
      [library.id]
    );

    for (const row of existingVideos.rows) {
      if (!diskPaths.has(row.file_path)) {
        await pool.query('DELETE FROM videos WHERE id = $1', [row.id]);
        removed++;
        console.log(`  🗑️  Removed movie: ${row.title} (file missing)`);
      }
    }

    // 2. Add new / update existing videos
    const existingPaths = new Set(existingVideos.rows.map(r => r.file_path));

    for (const filePath of videoFiles) {
      try {
        const info = parseMovieInfo(filePath);
        const dir = path.dirname(filePath);
        const images = findImages(dir);
        const fileSize = getFileSize(filePath);

        if (existingPaths.has(filePath)) {
          // Update existing entry (poster, size, etc.)
          await pool.query(`
            UPDATE videos SET title = $1, file_size = $2, poster_path = COALESCE($3, poster_path), 
            banner_path = COALESCE($4, banner_path), year = COALESCE($5, year)
            WHERE file_path = $6
          `, [info.title, fileSize, images.poster, images.banner, info.year, filePath]);
          updated++;
        } else {
          await pool.query(`
            INSERT INTO videos (title, original_filename, file_path, file_size, video_type, year, poster_path, banner_path, library_id)
            VALUES ($1, $2, $3, $4, 'movie', $5, $6, $7, $8)
          `, [info.title, path.basename(filePath), filePath, fileSize, info.year, images.poster, images.banner, library.id]);
          added++;
          console.log(`  ✅ Added movie: ${info.title}${info.year ? ` (${info.year})` : ''}`);
        }
      } catch (err) {
        errors++;
        console.error(`  ❌ Error processing ${filePath}:`, err.message);
      }
    }
  }

  console.log(`\n📊 Scan complete: ${added} added, ${updated} updated, ${removed} removed, ${skipped} skipped, ${errors} errors`);
  return { added, updated, removed, skipped, errors };
}

async function scanSeriesLibrary(library, scannedFiles, diskPaths) {
  let added = 0;
  let removed = 0;
  let updated = 0;
  let skipped = 0;

  // 1. Remove episodes whose files no longer exist
  const existingEpisodes = await pool.query(
    'SELECT id, file_path, title, series_id, season_id FROM videos WHERE library_id = $1',
    [library.id]
  );

  const removedSeriesIds = new Set();
  const removedSeasonIds = new Set();

  for (const row of existingEpisodes.rows) {
    if (!diskPaths.has(row.file_path)) {
      await pool.query('DELETE FROM videos WHERE id = $1', [row.id]);
      removed++;
      if (row.series_id) removedSeriesIds.add(row.series_id);
      if (row.season_id) removedSeasonIds.add(row.season_id);
      console.log(`  🗑️  Removed episode: ${row.title} (file missing)`);
    }
  }

  // Clean up empty seasons (no episodes left)
  for (const seasonId of removedSeasonIds) {
    const count = await pool.query('SELECT COUNT(*) as c FROM videos WHERE season_id = $1', [seasonId]);
    if (parseInt(count.rows[0].c) === 0) {
      await pool.query('DELETE FROM seasons WHERE id = $1', [seasonId]);
      console.log(`  🗑️  Removed empty season id=${seasonId}`);
    }
  }

  // Clean up empty series (no episodes left)
  for (const seriesId of removedSeriesIds) {
    const count = await pool.query('SELECT COUNT(*) as c FROM videos WHERE series_id = $1', [seriesId]);
    if (parseInt(count.rows[0].c) === 0) {
      await pool.query('DELETE FROM seasons WHERE series_id = $1', [seriesId]);
      await pool.query('DELETE FROM series WHERE id = $1', [seriesId]);
      console.log(`  🗑️  Removed empty series id=${seriesId}`);
    }
  }

  // 2. Add new episodes / update existing
  const existingPaths = new Set(existingEpisodes.rows.map(r => r.file_path));

  // Group files by series
  const seriesMap = new Map();

  for (const scannedFile of scannedFiles) {
    const { filePath, rootPath } = scannedFile;
    const info = parseSeriesInfo(filePath, rootPath);
    if (!info) continue;

    const seriesKey = `${info.seriesTitle}@@${rootPath}`;

    if (!seriesMap.has(seriesKey)) {
      seriesMap.set(seriesKey, {
        ...info,
        rootPath,
        episodes: [],
      });
    }

    seriesMap.get(seriesKey).episodes.push({
      ...info,
      rootPath,
      filePath,
      fileSize: getFileSize(filePath),
    });
  }

  for (const [seriesKey, seriesData] of seriesMap) {
    try {
      const seriesTitle = seriesData.seriesTitle;
      // Find or create series
      let seriesResult = await pool.query(
        'SELECT id FROM series WHERE title = $1 AND library_id = $2',
        [seriesTitle, library.id]
      );

      let seriesId;
      const seriesFolder = seriesData.seriesFolder
        ? path.join(seriesData.rootPath, seriesData.seriesFolder)
        : seriesData.rootPath;
      const seriesImages = findImages(seriesFolder);

      if (seriesResult.rows.length === 0) {
        seriesResult = await pool.query(
          'INSERT INTO series (title, library_id, folder_path, poster_path, banner_path) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [seriesTitle, library.id, seriesFolder, seriesImages.poster, seriesImages.banner]
        );
        seriesId = seriesResult.rows[0].id;
        console.log(`  📺 Created series: ${seriesTitle}`);
      } else {
        seriesId = seriesResult.rows[0].id;
        // Always update series images and folder_path on rescan
        await pool.query(
          'UPDATE series SET poster_path = COALESCE($1, poster_path), banner_path = COALESCE($2, banner_path), folder_path = $3 WHERE id = $4',
          [seriesImages.poster, seriesImages.banner, seriesFolder, seriesId]
        );
      }

      // Group episodes by season (use subfolder name as key when present)
      const seasonMap = new Map();
      for (const ep of seriesData.episodes) {
        // Use subfolderName as grouping key if it exists and is NOT a standard season folder
        const isStandardSeason = ep.seasonFolder && (/\b(?:season|temporada)\s*\d+/i.test(ep.seasonFolder) || /\bs\d+/i.test(ep.seasonFolder));
        const seasonKey = ep.subfolderName && !isStandardSeason
          ? `sub_${ep.subfolderName}`
          : String(ep.seasonNumber);
        if (!seasonMap.has(seasonKey)) {
          seasonMap.set(seasonKey, { episodes: [], seasonNumber: ep.seasonNumber, subfolderName: ep.subfolderName, seasonFolder: ep.seasonFolder });
        }
        seasonMap.get(seasonKey).episodes.push(ep);
      }

      // Auto-number seasons when there are multiple subfolder-based groups
      let autoSeasonNum = 0;
      const sortedSeasonKeys = [...seasonMap.keys()].sort((a, b) => {
        const na = parseInt(a), nb = parseInt(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.localeCompare(b);
      });

      for (const seasonKey of sortedSeasonKeys) {
        autoSeasonNum++;
        const group = seasonMap.get(seasonKey);
        const episodes = group.episodes;
        const isSubfolder = seasonKey.startsWith('sub_');
        const seasonNum = isSubfolder ? autoSeasonNum : group.seasonNumber;
        const seasonTitle = isSubfolder ? cleanTitle(group.subfolderName) : `Temporada ${seasonNum}`;

        // Find or create season
        let seasonResult;
        if (isSubfolder) {
          // For subfolder-based seasons, match by title + series
          seasonResult = await pool.query(
            'SELECT id FROM seasons WHERE series_id = $1 AND title = $2',
            [seriesId, seasonTitle]
          );
        } else {
          seasonResult = await pool.query(
            'SELECT id FROM seasons WHERE series_id = $1 AND season_number = $2',
            [seriesId, seasonNum]
          );
        }

        let seasonId;
        if (seasonResult.rows.length === 0) {
          const seasonFolderPath = episodes[0].seasonFolder
            ? path.join(seriesFolder, episodes[0].seasonFolder)
            : seriesFolder;

          seasonResult = await pool.query(
            'INSERT INTO seasons (series_id, season_number, title, folder_path) VALUES ($1, $2, $3, $4) RETURNING id',
            [seriesId, seasonNum, seasonTitle, seasonFolderPath]
          );
          seasonId = seasonResult.rows[0].id;
          console.log(`    📂 Created season: ${seasonTitle} (#${seasonNum})`);
        } else {
          seasonId = seasonResult.rows[0].id;
          // Update season number if needed
          await pool.query('UPDATE seasons SET season_number = $1 WHERE id = $2', [seasonNum, seasonId]);
        }

        // Add/update episodes
        for (const ep of episodes) {
          if (existingPaths.has(ep.filePath)) {
            // Update existing
            await pool.query(`
              UPDATE videos SET title = $1, file_size = $2, series_id = $3, season_id = $4, episode_number = $5
              WHERE file_path = $6
            `, [ep.episodeTitle, ep.fileSize, seriesId, seasonId, ep.episodeNumber, ep.filePath]);
            updated++;
          } else {
            await pool.query(`
              INSERT INTO videos (title, original_filename, file_path, file_size, video_type, series_id, season_id, episode_number, library_id)
              VALUES ($1, $2, $3, $4, 'episode', $5, $6, $7, $8)
            `, [ep.episodeTitle, path.basename(ep.filePath), ep.filePath, ep.fileSize, seriesId, seasonId, ep.episodeNumber, library.id]);
            added++;
            console.log(`      ✅ S${String(seasonNum).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')} - ${ep.episodeTitle}`);
          }
        }
      }
    } catch (err) {
      console.error(`  ❌ Error processing series ${seriesKey}:`, err.message);
    }
  }

  return { added, removed, updated, skipped };
}

module.exports = { scanLibrary, parseMovieInfo, parseSeriesInfo, findVideoFiles };

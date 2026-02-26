const fs = require('fs');
const path = require('path');
const { execSync, spawn, execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const axios = require('axios');
const cheerio = require('cheerio');
const unzipper = require('unzipper');
const { pool } = require('../config/db');

const SUBS_DIR = '/tmp/ubeflix-subs';
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.ssa', '.sub']);

// Ensure subs directory exists
try {
  if (!fs.existsSync(SUBS_DIR)) {
    fs.mkdirSync(SUBS_DIR, { recursive: true });
  }
} catch {}

// ===== Embedded subtitle extraction =====

/**
 * Get subtitle streams from a video file using ffprobe
 */
async function getSubtitleStreams(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-select_streams', 's',
      '-show_entries', 'stream=index,codec_name:stream_tags=language,title',
      '-of', 'json', filePath
    ], { timeout: 10000 });
    const data = JSON.parse(stdout);
    return (data.streams || []).map(s => ({
      index: s.index,
      codec: s.codec_name,
      language: s.tags?.language || 'und',
      title: s.tags?.title || '',
    }));
  } catch {
    return [];
  }
}

/**
 * Extract a subtitle stream from video and convert to VTT
 */
async function extractSubtitleToVTT(videoPath, streamIndex, outputPath) {
  try {
    await execFileAsync('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', videoPath,
      '-map', `0:${streamIndex}`, '-c:s', 'webvtt', outputPath
    ], { timeout: 30000 });
    return fs.existsSync(outputPath);
  } catch (err) {
    console.error(`Failed to extract subtitle stream ${streamIndex}:`, err.message);
    return false;
  }
}

/**
 * Find and extract embedded subtitles from a video file
 * Prioritizes Spanish subtitles
 */
async function extractEmbeddedSubtitles(videoId, filePath) {
  const streams = await getSubtitleStreams(filePath);
  if (streams.length === 0) return [];

  const videoSubDir = path.join(SUBS_DIR, String(videoId));
  if (!fs.existsSync(videoSubDir)) {
    fs.mkdirSync(videoSubDir, { recursive: true });
  }

  const spanishCodes = ['spa', 'es', 'esp', 'spanish', 'español', 'castellano', 'lat', 'latin'];
  const textCodecs = ['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text'];

  // Build extraction tasks
  const tasks = [];
  for (const stream of streams) {
    if (!textCodecs.includes(stream.codec)) continue;

    const lang = stream.language.toLowerCase();
    const title = stream.title.toLowerCase();
    let label = stream.title || stream.language;
    const isSpanish = spanishCodes.some(c => lang.includes(c) || title.includes(c));
    if (isSpanish && title.includes('lat')) label = 'Español Latino';
    else if (isSpanish) label = 'Español';

    const outFile = path.join(videoSubDir, `sub_${stream.index}.vtt`);
    tasks.push({ stream, outFile, label, isSpanish, lang });
  }

  // Extract all subtitle streams in parallel (max 4 concurrent)
  const extracted = [];
  const BATCH = 4;
  for (let i = 0; i < tasks.length; i += BATCH) {
    const batch = tasks.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(t => extractSubtitleToVTT(filePath, t.stream.index, t.outFile))
    );
    for (let j = 0; j < batch.length; j++) {
      if (results[j].status === 'fulfilled' && results[j].value) {
        const t = batch[j];
        extracted.push({
          video_id: videoId,
          label: t.label,
          language: t.isSpanish ? 'es' : t.lang.substring(0, 2) || 'und',
          format: 'vtt',
          file_path: t.outFile,
          source: 'embedded',
          is_default: t.isSpanish,
        });
      }
    }
  }

  // Batch insert to DB
  if (extracted.length > 0) {
    const values = [];
    const params = [];
    extracted.forEach((sub, i) => {
      const offset = i * 7;
      values.push(`($${offset+1}, $${offset+2}, $${offset+3}, $${offset+4}, $${offset+5}, $${offset+6}, $${offset+7})`);
      params.push(sub.video_id, sub.label, sub.language, sub.format, sub.file_path, sub.source, sub.is_default);
    });
    await pool.query(
      `INSERT INTO subtitles (video_id, label, language, format, file_path, source, is_default)
       VALUES ${values.join(', ')}
       ON CONFLICT DO NOTHING`,
      params
    );
  }

  return extracted;
}

// ===== External subtitle files =====

/**
 * Find external .srt/.vtt files next to the video file
 */
async function findExternalSubtitles(videoId, filePath) {
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, path.extname(filePath)).toLowerCase();
  const found = [];

  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (!SUBTITLE_EXTENSIONS.has(ext)) continue;

      const subBaseName = path.basename(file, ext).toLowerCase();
      // Match if subtitle filename starts with video filename
      if (!subBaseName.startsWith(baseName.substring(0, Math.min(baseName.length, 15)))) continue;

      const fullPath = path.join(dir, file);

      // Detect language from filename
      let label = 'Español';
      let language = 'es';
      const nameLower = subBaseName.toLowerCase();
      if (nameLower.includes('eng') || nameLower.includes('english')) {
        label = 'English'; language = 'en';
      } else if (nameLower.includes('lat')) {
        label = 'Español Latino';
      }

      // Convert SRT to VTT if needed
      let finalPath = fullPath;
      let format = ext.substring(1);

      if (ext === '.srt') {
        const videoSubDir = path.join(SUBS_DIR, String(videoId));
        if (!fs.existsSync(videoSubDir)) fs.mkdirSync(videoSubDir, { recursive: true });
        const vttPath = path.join(videoSubDir, `ext_${path.basename(file, ext)}.vtt`);
        try {
          await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-i', fullPath, vttPath], { timeout: 15000 });
          finalPath = vttPath;
          format = 'vtt';
        } catch {
          // Keep original SRT
        }
      }

      found.push({
        video_id: videoId,
        label,
        language,
        format,
        file_path: finalPath,
        source: 'external',
        is_default: language === 'es',
      });
    }
  } catch {}

  // Batch insert to DB
  if (found.length > 0) {
    const values = [];
    const params = [];
    found.forEach((sub, i) => {
      const offset = i * 7;
      values.push(`($${offset+1}, $${offset+2}, $${offset+3}, $${offset+4}, $${offset+5}, $${offset+6}, $${offset+7})`);
      params.push(sub.video_id, sub.label, sub.language, sub.format, sub.file_path, sub.source, sub.is_default);
    });
    await pool.query(
      `INSERT INTO subtitles (video_id, label, language, format, file_path, source, is_default)
       VALUES ${values.join(', ')}
       ON CONFLICT DO NOTHING`,
      params
    );
  }

  return found;
}

// ===== OpenSubtitles search & download =====
const { searchOpenSubtitles, downloadOpenSubtitles, autoSearchOpenSubtitles } = require('./opensubtitles');

// ===== Thumbnail generation =====

const THUMBS_DIR = '/tmp/ubeflix-thumbs';

try {
  if (!fs.existsSync(THUMBS_DIR)) {
    fs.mkdirSync(THUMBS_DIR, { recursive: true });
  }
} catch {}

/**
 * Generate a thumbnail from a video file
 * Captures a frame at ~10% of the duration
 */
async function generateThumbnail(videoId, filePath) {
  const thumbPath = path.join(THUMBS_DIR, `${videoId}.jpg`);

  // Return existing thumbnail
  if (fs.existsSync(thumbPath)) {
    return thumbPath;
  }

  try {
    // Get video duration
    let seekTo = '00:05:00'; // Default: 5 minutes in
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath
      ], { timeout: 10000 });
      const durationSec = parseFloat(stdout.trim());
      if (durationSec > 0) {
        const seekSec = Math.floor(durationSec * 0.1); // 10% in
        const h = Math.floor(seekSec / 3600);
        const m = Math.floor((seekSec % 3600) / 60);
        const s = seekSec % 60;
        seekTo = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      }
    } catch {}

    await execFileAsync('ffmpeg', [
      '-y', '-loglevel', 'error', '-ss', seekTo, '-i', filePath,
      '-vframes', '1', '-q:v', '3', '-vf', 'scale=480:-1', thumbPath
    ], { timeout: 15000 });

    if (fs.existsSync(thumbPath)) {
      // Update DB
      await pool.query('UPDATE videos SET thumbnail_path = $1 WHERE id = $2', [thumbPath, videoId]);
      return thumbPath;
    }
  } catch (err) {
    console.error(`Thumbnail generation failed for video ${videoId}:`, err.message);
  }

  return null;
}

/**
 * Generate thumbnails for all videos in a library
 */
async function generateLibraryThumbnails(libraryId) {
  const result = await pool.query(
    'SELECT id, file_path FROM videos WHERE library_id = $1 AND thumbnail_path IS NULL',
    [libraryId]
  );

  let generated = 0;
  for (const video of result.rows) {
    if (!fs.existsSync(video.file_path)) continue;
    const thumb = await generateThumbnail(video.id, video.file_path);
    if (thumb) generated++;
  }

  // Also generate for series (use first episode thumbnail)
  const seriesResult = await pool.query(
    `SELECT DISTINCT s.id as series_id, 
            (SELECT v.id FROM videos v WHERE v.series_id = s.id ORDER BY v.season_id, v.episode_number LIMIT 1) as first_episode_id
     FROM series s
     WHERE s.library_id = $1 AND s.thumbnail_path IS NULL`,
    [libraryId]
  );

  for (const row of seriesResult.rows) {
    if (!row.first_episode_id) continue;
    const videoResult = await pool.query('SELECT file_path FROM videos WHERE id = $1', [row.first_episode_id]);
    if (videoResult.rows.length === 0) continue;

    const filePath = videoResult.rows[0].file_path;
    const seriesThumbPath = path.join(THUMBS_DIR, `series_${row.series_id}.jpg`);

    if (!fs.existsSync(seriesThumbPath) && fs.existsSync(filePath)) {
      try {
        let seekTo = '00:02:00';
        try {
          const { stdout } = await execFileAsync('ffprobe', [
            '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath
          ], { timeout: 10000 });
          const sec = Math.floor(parseFloat(stdout.trim()) * 0.15);
          const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
          seekTo = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        } catch {}

        await execFileAsync('ffmpeg', [
          '-y', '-loglevel', 'error', '-ss', seekTo, '-i', filePath,
          '-vframes', '1', '-q:v', '3', '-vf', 'scale=480:-1', seriesThumbPath
        ], { timeout: 15000 });

        if (fs.existsSync(seriesThumbPath)) {
          await pool.query('UPDATE series SET thumbnail_path = $1 WHERE id = $2', [seriesThumbPath, row.series_id]);
          generated++;
        }
      } catch {}
    }
  }

  return generated;
}

module.exports = {
  extractEmbeddedSubtitles,
  findExternalSubtitles,
  searchOpenSubtitles,
  downloadOpenSubtitles,
  autoSearchOpenSubtitles,
  generateThumbnail,
  generateLibraryThumbnails,
  getSubtitleStreams,
  SUBS_DIR,
  THUMBS_DIR,
};

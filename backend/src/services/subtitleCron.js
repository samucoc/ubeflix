/**
 * Cron job for automatically downloading missing subtitles from OpenSubtitles.
 * 
 * Runs every day at 3:00 AM and downloads up to 20 subtitles (OpenSubtitles daily limit).
 * Also checks filesystem for existing external subtitle files before downloading.
 * 
 * Progress is tracked so it continues where it left off each day.
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');
const { autoSearchOpenSubtitles, login } = require('./opensubtitles');

const SUBS_DIR = '/tmp/ubeflix-subs';
const SUBTITLE_EXTENSIONS = ['.srt', '.vtt', '.ass', '.ssa', '.sub'];
const DAILY_LIMIT = 20;

// Track downloads done today (local counter + API remaining)
let downloadsToday = 0;
let lastResetDate = '';
let apiRemaining = null; // Track remaining from API response

function resetDailyCounter() {
  const today = new Date().toISOString().split('T')[0];
  if (today !== lastResetDate) {
    downloadsToday = 0;
    apiRemaining = null;
    lastResetDate = today;
  }
}

/**
 * Check if a video already has subtitle files on the filesystem
 * (in the same directory as the video or in the subs volume)
 */
function hasSubtitleFiles(videoFilePath, videoId) {
  // Check 1: Subtitle files next to the video file
  const videoDir = path.dirname(videoFilePath);
  const videoBase = path.basename(videoFilePath, path.extname(videoFilePath));

  try {
    if (fs.existsSync(videoDir)) {
      const files = fs.readdirSync(videoDir);
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        const base = path.basename(file, ext);
        // Match same name or name with language suffix (e.g., movie.es.srt)
        if (SUBTITLE_EXTENSIONS.includes(ext) && 
            (base === videoBase || base.startsWith(videoBase + '.'))) {
          return true;
        }
      }
    }
  } catch {}

  // Check 2: Downloaded subs in our subs directory
  const subsDir = path.join(SUBS_DIR, String(videoId));
  try {
    if (fs.existsSync(subsDir)) {
      const files = fs.readdirSync(subsDir);
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (SUBTITLE_EXTENSIONS.includes(ext)) {
          return true;
        }
      }
    }
  } catch {}

  return false;
}

/**
 * Main cron function: download subtitles for videos that don't have any.
 * Respects the daily download limit of 20.
 */
async function downloadMissingSubtitles() {
  resetDailyCounter();

  const remaining = apiRemaining !== null ? apiRemaining : (DAILY_LIMIT - downloadsToday);
  if (remaining <= 0) {
    console.log('📋 [SubCron] Daily download limit reached. Will continue tomorrow.');
    return { downloaded: 0, skipped: 0, errors: 0, message: 'Límite diario alcanzado' };
  }

  console.log(`\n🕐 [SubCron] Starting subtitle download cron — ${remaining} downloads remaining today`);

  // Series to skip (no subs available or not needed)
  const SKIP_SERIES = ['31 minutos'];

  // Get videos without subtitles in the DB, prioritize movies first, then episodes
  const result = await pool.query(`
    SELECT v.id, v.title, v.year, v.video_type, v.file_path, v.original_filename,
           s.title as series_title, se.season_number, v.episode_number
    FROM videos v
    LEFT JOIN series s ON v.series_id = s.id
    LEFT JOIN seasons se ON v.season_id = se.id
    WHERE NOT EXISTS (SELECT 1 FROM subtitles sub WHERE sub.video_id = v.id)
      AND (s.title IS NULL OR s.title NOT IN (${SKIP_SERIES.map((_, i) => `$${i + 1}`).join(', ')}))
    ORDER BY 
      CASE v.video_type WHEN 'movie' THEN 0 ELSE 1 END,
      s.title NULLS LAST,
      se.season_number NULLS LAST,
      v.episode_number NULLS LAST,
      v.title
  `, SKIP_SERIES);

  const videosWithoutSubs = result.rows;
  console.log(`📋 [SubCron] ${videosWithoutSubs.length} videos without subtitles in DB`);

  if (videosWithoutSubs.length === 0) {
    console.log('✅ [SubCron] All videos have subtitles!');
    return { downloaded: 0, skipped: 0, errors: 0, message: '¡Todos los videos tienen subtítulos!' };
  }

  let downloaded = 0;
  let skipped = 0;
  let errors = 0;
  let filesystemSkipped = 0;

  for (const video of videosWithoutSubs) {
    // Check both local counter and API remaining
    if (downloadsToday >= DAILY_LIMIT || (apiRemaining !== null && apiRemaining <= 0)) {
      console.log(`📋 [SubCron] Daily limit reached (local: ${downloadsToday}, API remaining: ${apiRemaining}). Continuing tomorrow.`);
      break;
    }

    const label = video.series_title 
      ? `${video.series_title} S${String(video.season_number || 0).padStart(2, '0')}E${String(video.episode_number || 0).padStart(2, '0')}`
      : `${video.title}${video.year ? ` (${video.year})` : ''}`;

    // Check filesystem first
    if (hasSubtitleFiles(video.file_path, video.id)) {
      filesystemSkipped++;
      continue; // Already has files on disk, just not in DB
    }

    try {
      console.log(`\n📥 [SubCron] [${downloadsToday + 1}/${DAILY_LIMIT}] Searching: ${label}`);
      
      const result = await autoSearchOpenSubtitles(video.id);

      if (result.skipped) {
        skipped++;
      } else if (result.success) {
        downloaded++;
        downloadsToday++;
        // Update API remaining count
        if (result.remaining !== undefined && result.remaining !== null) {
          apiRemaining = result.remaining;
        }
        console.log(`✅ [SubCron] Downloaded subtitle for: ${label} (API remaining: ${apiRemaining})`);
      } else {
        errors++;
        console.log(`⚠️ [SubCron] No subtitle found for: ${label} — ${result.error || 'unknown'}`);
        // If API says limit reached, stop
        if (result.error?.includes('Límite') || result.error?.includes('406')) {
          console.log('📋 [SubCron] API download limit reached. Stopping for today.');
          apiRemaining = 0;
          break;
        }
      }

      // Rate limiting: wait 1.5 seconds between API calls to be respectful
      await new Promise(r => setTimeout(r, 1500));

    } catch (err) {
      errors++;
      console.error(`❌ [SubCron] Error processing ${label}:`, err.message);

      // If rate limited (429), stop and retry later
      if (err.message?.includes('429') || err.message?.includes('Rate limit')) {
        console.log('⏳ [SubCron] Rate limited. Stopping for today.');
        break;
      }
      // If download limit reached (406), stop
      if (err.message?.includes('406') || err.message?.includes('Límite')) {
        console.log('📋 [SubCron] Download limit reached. Stopping for today.');
        break;
      }

      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const pendingCount = videosWithoutSubs.length - downloaded - skipped - filesystemSkipped;
  const daysNeeded = Math.ceil(pendingCount / DAILY_LIMIT);

  console.log(`\n📊 [SubCron] Summary:`);
  console.log(`   Downloaded: ${downloaded}`);
  console.log(`   Skipped (already had subs): ${skipped}`);
  console.log(`   Skipped (filesystem): ${filesystemSkipped}`);
  console.log(`   Errors/not found: ${errors}`);
  console.log(`   Remaining: ~${pendingCount} videos (~${daysNeeded} days at ${DAILY_LIMIT}/day)`);

  return { downloaded, skipped, errors, filesystemSkipped, pending: pendingCount };
}

/**
 * Schedule the cron job. Runs at 3:00 AM every day.
 * Also runs once at startup after a 30-second delay.
 */
function startSubtitleCron() {
  console.log('⏰ [SubCron] Subtitle download cron scheduled (daily at 3:00 AM)');

  // Run at startup after 30s delay (let the server settle)
  setTimeout(async () => {
    console.log('⏰ [SubCron] Running initial subtitle check...');
    try {
      await login();
      await downloadMissingSubtitles();
    } catch (err) {
      console.error('❌ [SubCron] Initial run error:', err.message);
    }
  }, 30000);

  // Schedule daily at 3:00 AM
  function scheduleNext() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(3, 0, 0, 0);
    
    // If it's already past 3 AM today, schedule for tomorrow
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    const msUntilNext = next.getTime() - now.getTime();
    const hoursUntil = (msUntilNext / 3600000).toFixed(1);
    console.log(`⏰ [SubCron] Next run in ${hoursUntil} hours (${next.toLocaleString()})`);

    setTimeout(async () => {
      try {
        resetDailyCounter();
        await login();
        await downloadMissingSubtitles();
      } catch (err) {
        console.error('❌ [SubCron] Cron run error:', err.message);
      }
      // Schedule the next day
      scheduleNext();
    }, msUntilNext);
  }

  scheduleNext();
}

module.exports = {
  startSubtitleCron,
  downloadMissingSubtitles,
};

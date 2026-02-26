const { pool } = require('./src/config/db');
(async () => {
  const total = await pool.query('SELECT COUNT(*) as cnt FROM videos');
  const withSubs = await pool.query('SELECT COUNT(DISTINCT video_id) as cnt FROM subtitles');
  const withoutSubs = await pool.query(`SELECT COUNT(*) as cnt FROM videos v WHERE NOT EXISTS (SELECT 1 FROM subtitles s WHERE s.video_id = v.id)`);
  const byType = await pool.query('SELECT video_type, COUNT(*) as cnt FROM videos GROUP BY video_type');
  console.log('Total videos:', total.rows[0].cnt);
  console.log('With subs:', withSubs.rows[0].cnt);
  console.log('Without subs:', withoutSubs.rows[0].cnt);
  console.log('By type:', byType.rows);
  
  const sample = await pool.query(`
    SELECT v.id, v.title, v.year, v.video_type, v.original_filename,
           s.title as series_title, se.season_number, v.episode_number
    FROM videos v
    LEFT JOIN series s ON v.series_id = s.id
    LEFT JOIN seasons se ON v.season_id = se.id
    WHERE NOT EXISTS (SELECT 1 FROM subtitles sub WHERE sub.video_id = v.id)
    ORDER BY v.video_type, v.title
    LIMIT 15
  `);
  console.log('\nSample without subs:');
  sample.rows.forEach(r => {
    const info = r.series_title ? `${r.series_title} S${r.season_number}E${r.episode_number}` : `${r.title}${r.year ? ' (' + r.year + ')' : ''}`;
    console.log(`  [${r.id}] ${info} | ${r.original_filename}`);
  });
  
  await pool.end();
})();

const axios = require('axios');

(async () => {
  try {
    // Get homepage with cookies
    const r = await axios.post('http://flaresolverr:8191/v1', {
      cmd: 'request.get',
      url: 'https://www.subdivx.com/',
      maxTimeout: 60000,
    }, { timeout: 90000 });

    const cookies = r.data.solution?.cookies || [];
    const ua = r.data.solution?.userAgent || '';
    const cookieStr = cookies.map(c => c.name + '=' + c.value).join('; ');

    // Get the main JS file that handles search
    console.log('=== Fetching index-min.js ===');
    const jsResp = await axios.get('https://www.subdivx.com/js/index-min.js?v=4.24', {
      headers: {
        'User-Agent': ua,
        'Cookie': cookieStr,
        'Referer': 'https://www.subdivx.com/',
      },
      timeout: 15000,
    });
    
    const js = jsResp.data;
    console.log('JS Length:', js.length);
    
    // Find API related patterns
    const patterns = [
      /api[_\-]?key/gi,
      /['"](\/api\/[^'"]*)['"]/g,
      /buscar|search/gi,
      /ajax\.php/gi,
      /headers.*api/gi,
      /x-api-key|authorization/gi,
      /apikey|token/gi,
    ];

    for (const p of patterns) {
      const matches = js.match(p);
      if (matches) {
        console.log(`\nPattern ${p.source}:`, matches.length, 'matches');
        // Show surrounding context for each match
        let m;
        p.lastIndex = 0;
        let count = 0;
        while ((m = p.exec(js)) && count < 5) {
          const start = Math.max(0, m.index - 100);
          const end = Math.min(js.length, m.index + m[0].length + 100);
          console.log(`  Context: ...${js.substring(start, end)}...`);
          count++;
        }
      }
    }

    // Also search for fetch/$.ajax patterns
    const fetchPattern = /fetch\(|\.ajax\(|\$\.get\(|\$\.post\(/g;
    let fm;
    console.log('\n=== Fetch/Ajax calls ===');
    let count = 0;
    while ((fm = fetchPattern.exec(js)) && count < 10) {
      const start = Math.max(0, fm.index - 50);
      const end = Math.min(js.length, fm.index + 300);
      console.log(`\n  ${js.substring(start, end)}`);
      count++;
    }

  } catch (e) {
    console.error('Error:', e.message);
  }
})();

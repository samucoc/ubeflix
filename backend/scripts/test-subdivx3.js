const axios = require('axios');
const cheerio = require('cheerio');

(async () => {
  try {
    // Use existing session
    const r = await axios.post('http://flaresolverr:8191/v1', {
      cmd: 'request.get',
      url: 'https://www.subdivx.com/',
      maxTimeout: 60000,
    }, { timeout: 90000 });

    const html = r.data.solution?.response || '';
    const cookies = r.data.solution?.cookies || [];
    const ua = r.data.solution?.userAgent || '';
    const cookieStr = cookies.map(c => c.name + '=' + c.value).join('; ');

    // Extract all script content
    const scriptMatches = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
    
    console.log('=== ALL SCRIPTS ===');
    scriptMatches.forEach((s, i) => {
      const content = s.replace(/<\/?script[^>]*>/gi, '').trim();
      if (content.length > 10) {
        console.log(`\n--- Script ${i} (${content.length} chars) ---`);
        console.log(content.substring(0, 3000));
      }
    });

    // Find script src URLs
    const ch = cheerio.load(html);
    console.log('\n=== SCRIPT SRC FILES ===');
    ch('script[src]').each((i, el) => {
      console.log(ch(el).attr('src'));
    });

    // Check for any hidden inputs or forms
    console.log('\n=== INPUTS ===');
    ch('input').each((i, el) => {
      console.log(ch(el).attr('type'), ch(el).attr('name'), ch(el).attr('id'), ch(el).attr('placeholder'));
    });

    // Try to find the search form
    console.log('\n=== Search-related elements ===');
    ch('[id*=buscar], [name*=buscar], [class*=search], [id*=search], [placeholder*=Buscar]').each((i, el) => {
      const tag = el.tagName || el.name;
      console.log(tag, ch(el).attr('id'), ch(el).attr('name'), ch(el).attr('class'), ch(el).attr('placeholder'));
    });

    // Try a POST to the homepage with search
    console.log('\n=== Trying POST search ===');
    try {
      const postResp = await axios.post('https://www.subdivx.com/inc/ajax.php', 
        'acession=buscar&buscar=28+Days+Later&oxession=1',
        {
          headers: {
            'User-Agent': ua,
            'Cookie': cookieStr,
            'Referer': 'https://www.subdivx.com/',
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
          },
          timeout: 15000,
        }
      );
      console.log('POST Status:', postResp.status);
      const data = typeof postResp.data === 'string' ? postResp.data : JSON.stringify(postResp.data);
      console.log('POST Data (first 1000):', data.substring(0, 1000));
    } catch (e) {
      console.log('POST failed:', e.response?.status, e.message);
    }

    // Try other potential API URLs
    const urls = [
      'https://www.subdivx.com/api/search?q=28+Days+Later',
      'https://www.subdivx.com/api/buscar?q=28+Days+Later',
      'https://www.subdivx.com/inc/ajax.php',
    ];
    
    for (const url of urls) {
      console.log(`\nTrying: ${url}`);
      try {
        const resp = await axios.get(url, {
          headers: { 'User-Agent': ua, 'Cookie': cookieStr, 'Referer': 'https://www.subdivx.com/' },
          timeout: 10000,
        });
        const data = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
        console.log('Status:', resp.status, '- Data:', data.substring(0, 500));
      } catch (e) {
        console.log('Failed:', e.response?.status);
      }
    }

  } catch (e) {
    console.error('Error:', e.message);
  }
})();

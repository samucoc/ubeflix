const axios = require('axios');

(async () => {
  try {
    let session;
    try {
      const sr = await axios.post('http://flaresolverr:8191/v1', { cmd: 'sessions.create' }, { timeout: 30000 });
      session = sr.data.session;
      console.log('Session:', session);
    } catch {}

    // First get the homepage and extract cookies
    const home = await axios.post('http://flaresolverr:8191/v1', {
      cmd: 'request.get',
      url: 'https://www.subdivx.com/',
      maxTimeout: 60000,
      ...(session && { session }),
    }, { timeout: 90000 });

    const cookies = home.data.solution?.cookies || [];
    const ua = home.data.solution?.userAgent || '';
    console.log('Cookies:', cookies.length);
    console.log('UA:', ua);

    // Now try direct AJAX with these cookies
    const cookieStr = cookies.map(c => c.name + '=' + c.value).join('; ');
    console.log('Cookie string:', cookieStr.substring(0, 100));

    // Try the AJAX endpoint directly
    const ajaxUrl = 'https://www.subdivx.com/inc/ajax.php?acession=buscar&buscar=28+Days+Later&oxession=1';
    console.log('\nTrying AJAX directly with cookies...');
    try {
      const ajaxResp = await axios.get(ajaxUrl, {
        headers: {
          'User-Agent': ua,
          'Cookie': cookieStr,
          'Referer': 'https://www.subdivx.com/',
          'Accept': '*/*',
          'X-Requested-With': 'XMLHttpRequest',
        },
        timeout: 15000,
      });
      console.log('AJAX Status:', ajaxResp.status);
      console.log('AJAX Data type:', typeof ajaxResp.data);
      const dataStr = typeof ajaxResp.data === 'string' ? ajaxResp.data : JSON.stringify(ajaxResp.data);
      console.log('AJAX Data (first 1000):', dataStr.substring(0, 1000));
    } catch (e) {
      console.log('AJAX failed:', e.response?.status, e.message);
    }

    // Also dump the search page HTML to find the JS/API endpoints
    const searchResult = await axios.post('http://flaresolverr:8191/v1', {
      cmd: 'request.get',
      url: 'https://www.subdivx.com/?buscar=28+Days+Later&acession=buscar',
      maxTimeout: 60000,
      ...(session && { session }),
    }, { timeout: 90000 });

    const html = searchResult.data.solution?.response || '';
    console.log('\nSearch page length:', html.length);

    // Find script tags and API calls
    const scriptMatches = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
    console.log('Script tags:', scriptMatches.length);
    
    // Look for fetch/ajax/API patterns in scripts
    for (const script of scriptMatches) {
      if (script.includes('ajax') || script.includes('fetch') || script.includes('api') || script.includes('buscar')) {
        console.log('\n=== Interesting script ===');
        console.log(script.substring(0, 2000));
      }
    }

    // Look for table/tbody content
    const cheerio = require('cheerio');
    const ch = cheerio.load(html);
    console.log('\ntable:', ch('table').length);
    console.log('tbody tr:', ch('tbody tr').length);
    console.log('form:', ch('form').length);
    
    // Print form actions
    ch('form').each((i, el) => {
      console.log('Form', i, ':', ch(el).attr('action'), ch(el).attr('method'));
    });

    // Print all data attributes
    ch('[data-src], [data-url], [data-id]').each((i, el) => {
      console.log('Data attr:', ch(el).attr('data-src') || ch(el).attr('data-url') || ch(el).attr('data-id'));
    });

  } catch (e) {
    console.error('Error:', e.message);
  }
})();

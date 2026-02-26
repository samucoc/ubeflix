const axios = require('axios');

const FLARESOLVERR_URL = 'http://flaresolverr:8191/v1';

async function main() {
  // Get cookies
  const resp = await axios.post(FLARESOLVERR_URL, {
    cmd: 'request.get',
    url: 'https://www.subdivx.com/',
    maxTimeout: 60000
  });
  const cookies = resp.data.solution.cookies;
  const userAgent = resp.data.solution.userAgent;
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  console.log('Cookies:', cookies.map(c => c.name).join(', '));
  
  const headers = {
    'User-Agent': userAgent,
    'Cookie': cookieStr,
    'Referer': 'https://www.subdivx.com/',
    'Origin': 'https://www.subdivx.com',
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': 'application/json, text/javascript, */*; q=0.01'
  };

  // Test /sdx/api/ with various actions
  const tests = [
    { url: 'https://www.subdivx.com/sdx/api/', params: { action: 'foro_stats' }, label: '/sdx/api/ foro_stats' },
    { url: 'https://www.subdivx.com/sdx/api/', params: { action: 'search', q: '28 Days Later' }, label: '/sdx/api/ search' },
    { url: 'https://www.subdivx.com/sdx/api/', params: { action: 'buscar', q: '28 Days Later' }, label: '/sdx/api/ buscar' },
    { url: 'https://www.subdivx.com/sdx/api/', params: { q: '28 Days Later' }, label: '/sdx/api/ q only' },
    { url: 'https://www.subdivx.com/sdx/api/', params: { action: 'search', buscar: '28 Days Later' }, label: '/sdx/api/ search+buscar' },
    { url: 'https://www.subdivx.com/sdx/api/', params: {}, label: '/sdx/api/ no params' },
  ];
  
  for (const test of tests) {
    console.log(`\n=== ${test.label} ===`);
    try {
      const r = await axios.get(test.url, { params: test.params, headers, timeout: 15000, validateStatus: () => true });
      console.log('Status:', r.status);
      const data = typeof r.data === 'string' ? r.data.substring(0, 300) : JSON.stringify(r.data).substring(0, 300);
      console.log('Data:', data);
    } catch (e) {
      console.log('Error:', e.message);
    }
  }

  // Try POST to /sdx/api/
  console.log('\n=== POST /sdx/api/ search ===');
  try {
    const r = await axios.post('https://www.subdivx.com/sdx/api/', 
      { action: 'search', q: '28 Days Later' },
      { headers: { ...headers, 'Content-Type': 'application/json' }, timeout: 15000, validateStatus: () => true }
    );
    console.log('Status:', r.status);
    const data = typeof r.data === 'string' ? r.data.substring(0, 300) : JSON.stringify(r.data).substring(0, 300);
    console.log('Data:', data);
  } catch (e) {
    console.log('Error:', e.message);
  }

  // Try FlareSolverr GET to /sdx/api/ - bypasses Cloudflare
  console.log('\n=== FlareSolverr /sdx/api/ foro_stats ===');
  try {
    const r = await axios.post(FLARESOLVERR_URL, {
      cmd: 'request.get',
      url: 'https://www.subdivx.com/sdx/api/?action=foro_stats',
      maxTimeout: 60000
    });
    console.log('Status:', r.data.status);
    const body = r.data.solution.response;
    console.log('Response (first 500):', body.substring(0, 500));
    // Try to extract JSON from <pre> tags
    const preMatch = body.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
    if (preMatch) {
      console.log('Pre content:', preMatch[1].substring(0, 300));
    }
  } catch (e) {
    console.log('Error:', e.message);
  }

  // Try /sdx/api/ search via FlareSolverr
  console.log('\n=== FlareSolverr /sdx/api/ search ===');
  try {
    const r = await axios.post(FLARESOLVERR_URL, {
      cmd: 'request.get',
      url: 'https://www.subdivx.com/sdx/api/?action=search&q=28+Days+Later',
      maxTimeout: 60000
    });
    const body = r.data.solution.response;
    console.log('Response length:', body.length);
    console.log('Response (first 500):', body.substring(0, 500));
    const preMatch = body.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
    if (preMatch) {
      console.log('Pre content:', preMatch[1].substring(0, 300));
    }
  } catch (e) {
    console.log('Error:', e.message);
  }

  // Also check the full JS for all /sdx/api/ references
  console.log('\n=== All /sdx/api/ references in JS ===');
  const jsResp = await axios.get('https://www.subdivx.com/js/index-min.js?v=4.24', {
    headers: { 'User-Agent': userAgent, 'Cookie': cookieStr, 'Referer': 'https://www.subdivx.com/' }
  });
  const js = jsResp.data;
  const apiRegex = /sdx\/api\/[^"'\s,}]{0,200}/g;
  let m;
  while ((m = apiRegex.exec(js)) !== null) {
    console.log('  ', m[0]);
  }
  
  // Also broader search
  const apiRegex2 = /.{0,100}sdx\/api.{0,200}/g;
  while ((m = apiRegex2.exec(js)) !== null) {
    console.log('  FULL:', m[0].substring(0, 250));
  }
}

main().catch(err => console.error('FATAL:', err.message));

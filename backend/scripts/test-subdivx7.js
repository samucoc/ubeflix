const axios = require('axios');

const FLARESOLVERR_URL = 'http://flaresolverr:8191/v1';
const SESSION_ID = 'subdivx_' + Date.now();

async function createSession() {
  try {
    await axios.post(FLARESOLVERR_URL, {
      cmd: 'sessions.create',
      session: SESSION_ID
    });
    console.log('Session created:', SESSION_ID);
  } catch (e) {
    console.log('Session create error (may already exist):', e.message);
  }
}

async function destroySession() {
  try {
    await axios.post(FLARESOLVERR_URL, {
      cmd: 'sessions.destroy',
      session: SESSION_ID
    });
  } catch (e) {}
}

async function flareGet(url) {
  const resp = await axios.post(FLARESOLVERR_URL, {
    cmd: 'request.get',
    url,
    session: SESSION_ID,
    maxTimeout: 60000
  });
  return resp.data;
}

async function main() {
  await createSession();
  
  try {
    // Step 1: Navigate to main page to solve Cloudflare
    console.log('=== Step 1: Solve Cloudflare challenge ===');
    const mainResp = await flareGet('https://www.subdivx.com/');
    const cookies = mainResp.solution.cookies;
    const userAgent = mainResp.solution.userAgent;
    console.log('Cookies:', cookies.map(c => c.name).join(', '));
    console.log('UA:', userAgent);
    
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    
    // Step 2: Try AJAX with full browser-like headers
    console.log('\n=== Step 2: AJAX with full headers ===');
    
    const postBody = 'draw=1&start=0&length=25&tabla=resultados&buscar424=28+Days+Later&token=&filtros=';
    
    try {
      const ajaxResp = await axios({
        method: 'POST',
        url: 'https://www.subdivx.com/inc/ajax.php',
        data: postBody,
        headers: {
          'User-Agent': userAgent,
          'Cookie': cookieStr,
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://www.subdivx.com/',
          'Origin': 'https://www.subdivx.com',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
          'Sec-Ch-Ua': '"Chromium";v="142", "Not=A?Brand";v="99"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Linux"',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin'
        },
        timeout: 30000,
        validateStatus: () => true
      });
      
      console.log('Status:', ajaxResp.status);
      console.log('Content-Type:', ajaxResp.headers['content-type']);
      const data = ajaxResp.data;
      console.log('Data type:', typeof data);
      
      if (typeof data === 'object') {
        console.log('JSON keys:', Object.keys(data));
        if (data.data) {
          console.log('Results count:', data.data.length);
          if (data.data.length > 0) {
            console.log('First result:', JSON.stringify(data.data[0]).substring(0, 500));
          }
        }
        if (data.token) console.log('Token:', data.token);
        if (data.recordsTotal !== undefined) console.log('Total:', data.recordsTotal);
        if (data.error) console.log('Error:', data.error);
        if (data.mensaje) console.log('Mensaje:', data.mensaje);
      } else {
        const str = String(data);
        console.log('Response length:', str.length);
        console.log('First 500 chars:', str.substring(0, 500));
        if (str.includes('Just a moment')) console.log('*** CLOUDFLARE BLOCKED ***');
      }
    } catch (e) {
      console.log('AJAX Error:', e.message);
      if (e.response) {
        console.log('Response status:', e.response.status);
        console.log('Response headers:', JSON.stringify(e.response.headers).substring(0, 300));
      }
    }
    
    // Step 3: Try loading the search URL directly via FlareSolverr
    console.log('\n=== Step 3: Load search page via FlareSolverr ===');
    const searchResp = await flareGet('https://www.subdivx.com/index.php?buscar424=28+Days+Later&acession=buscar');
    const searchHtml = searchResp.solution.response;
    console.log('Search page length:', searchHtml.length);
    console.log('Title match:', searchHtml.match(/<title>(.*?)<\/title>/)?.[1]);
    
    // Check for results in the HTML
    if (searchHtml.includes('tblResultados')) console.log('Found tblResultados table');
    if (searchHtml.includes('28 Days')) console.log('Found "28 Days" in response');
    if (searchHtml.includes('resultado')) console.log('Found "resultado" in response');
    
    // Look for any data in the HTML response
    const scriptTags = searchHtml.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
    console.log('Script tags:', scriptTags.length);
    
    // Check for data embedded in page
    const dataMatches = searchHtml.match(/data\s*[:=]\s*\[[\s\S]{0,200}/g) || [];
    console.log('Data arrays in page:', dataMatches.length);
    if (dataMatches.length > 0) {
      dataMatches.forEach((m, i) => console.log(`  Data[${i}]:`, m.substring(0, 150)));
    }

    // Step 4: Also try the old URL format
    console.log('\n=== Step 4: Try old format /index.php?buscar=... ===');
    const oldResp = await flareGet('https://www.subdivx.com/index.php?buscar=28+Days+Later&accion=5&maession=');
    const oldHtml = oldResp.solution.response;
    console.log('Old format page length:', oldHtml.length);
    console.log('Title:', oldHtml.match(/<title>(.*?)<\/title>/)?.[1]);
    if (oldHtml.includes('28 Days')) console.log('Found search query in old format response');
    
  } finally {
    await destroySession();
  }
}

main().catch(err => console.error('FATAL:', err.message));

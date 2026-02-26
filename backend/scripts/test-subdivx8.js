const axios = require('axios');

const FLARESOLVERR_URL = 'http://flaresolverr:8191/v1';
const SESSION_ID = 'subdivx_' + Date.now();

async function main() {
  // Create session
  await axios.post(FLARESOLVERR_URL, { cmd: 'sessions.create', session: SESSION_ID });
  console.log('Session created');
  
  try {
    // Step 1: Solve Cloudflare on main page
    console.log('=== Step 1: Solve Cloudflare ===');
    const mainResp = await axios.post(FLARESOLVERR_URL, {
      cmd: 'request.get',
      url: 'https://www.subdivx.com/',
      session: SESSION_ID,
      maxTimeout: 60000
    });
    console.log('Main page status:', mainResp.data.status);
    console.log('Cookies:', mainResp.data.solution.cookies.map(c => c.name).join(', '));
    
    // Step 2: POST to ajax.php using same session
    console.log('\n=== Step 2: POST search via FlareSolverr session ===');
    const searchResp = await axios.post(FLARESOLVERR_URL, {
      cmd: 'request.post',
      url: 'https://www.subdivx.com/inc/ajax.php',
      session: SESSION_ID,
      maxTimeout: 60000,
      postData: 'draw=1&start=0&length=25&tabla=resultados&buscar424=28+Days+Later&token=&filtros='
    });
    
    console.log('Search status:', searchResp.data.status);
    console.log('Solution status:', searchResp.data.solution.status);
    const body = searchResp.data.solution.response;
    console.log('Response length:', body.length);
    console.log('First 500:', body.substring(0, 500));
    
    // Check if it contains JSON
    // Chrome might render JSON as <pre> text
    const preMatch = body.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
    if (preMatch) {
      console.log('\n=== Found <pre> content ===');
      try {
        const jsonData = JSON.parse(preMatch[1]);
        console.log('Keys:', Object.keys(jsonData));
        if (jsonData.data) {
          console.log('Results:', jsonData.data.length);
          if (jsonData.data.length > 0) {
            console.log('First:', JSON.stringify(jsonData.data[0]).substring(0, 500));
          }
        }
      } catch (e) {
        console.log('Pre content (first 500):', preMatch[1].substring(0, 500));
      }
    }
    
    // Try to find JSON anywhere in the response
    const jsonPatterns = body.match(/\{"draw"[\s\S]*?\}$/m);
    if (jsonPatterns) {
      console.log('\n=== Found draw JSON ===');
      console.log(jsonPatterns[0].substring(0, 500));
    }
    
    // Look for recordsTotal pattern
    const recordsMatch = body.match(/recordsTotal[^,}]*/);
    if (recordsMatch) console.log('Records match:', recordsMatch[0]);
    
    // Step 3: Try with custom headers via FlareSolverr
    console.log('\n=== Step 3: POST with custom headers ===');
    const searchResp2 = await axios.post(FLARESOLVERR_URL, {
      cmd: 'request.post',
      url: 'https://www.subdivx.com/inc/ajax.php',
      session: SESSION_ID,
      maxTimeout: 60000,
      postData: 'draw=1&start=0&length=25&tabla=resultados&buscar424=28+Days+Later&token=&filtros=',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01'
      }
    });
    
    const body2 = searchResp2.data.solution.response;
    console.log('Response2 length:', body2.length);
    console.log('Response2 first 500:', body2.substring(0, 500));
    
    // Check for pre tag again
    const preMatch2 = body2.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
    if (preMatch2) {
      console.log('\n=== Pre content ===');
      const content = preMatch2[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
      console.log('Content (first 1000):', content.substring(0, 1000));
      try {
        const j = JSON.parse(content);
        console.log('Parsed! Keys:', Object.keys(j));
        if (j.data) console.log('Results count:', j.data.length);
      } catch (e) {
        console.log('Not valid JSON');
      }
    }
    
    // Also check body content more broadly
    const bodyMatch = body2.match(/<body[^>]*>([\s\S]*?)<\/body>/);
    if (bodyMatch) {
      const bodyContent = bodyMatch[1].trim();
      console.log('\nBody content (first 500):', bodyContent.substring(0, 500));
    }

  } finally {
    await axios.post(FLARESOLVERR_URL, { cmd: 'sessions.destroy', session: SESSION_ID }).catch(() => {});
  }
}

main().catch(err => console.error('FATAL:', err.message));

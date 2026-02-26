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
  
  // Fetch JS
  const jsResp = await axios.get('https://www.subdivx.com/js/index-min.js?v=4.24', {
    headers: { 'User-Agent': userAgent, 'Cookie': cookieStr, 'Referer': 'https://www.subdivx.com/' }
  });
  const js = jsResp.data;
  
  // Search for login-related code
  console.log('=== Login-related code ===');
  const loginRegex = /.{0,200}(login|navLogin|iniciar|acceder|password|contraseña|clave|usuario|nick).{0,200}/gi;
  let m;
  let seen = new Set();
  while ((m = loginRegex.exec(js)) !== null) {
    const snippet = m[0].trim();
    if (snippet.length > 20 && !seen.has(snippet.substring(0, 50))) {
      seen.add(snippet.substring(0, 50));
      if (snippet.includes('ajax') || snippet.includes('post') || snippet.includes('fetch') || 
          snippet.includes('login') || snippet.includes('Login') || snippet.includes('clave') ||
          snippet.includes('nick') || snippet.includes('password')) {
        console.log('\n---');
        console.log(snippet.substring(0, 300));
      }
    }
  }
  
  // Specifically find navLogin click handler
  console.log('\n\n=== navLogin handler ===');
  const navLoginRegex = /.{0,300}navLogin.{0,500}/g;
  while ((m = navLoginRegex.exec(js)) !== null) {
    console.log('\n---');
    console.log(m[0].substring(0, 500));
  }
  
  // Find the function that creates the DataTable for resultados
  console.log('\n\n=== DataTable initialization ===');
  const dtInitRegex = /.{0,200}DataTable\(\{.{0,500}/g;
  while ((m = dtInitRegex.exec(js)) !== null) {
    if (m[0].includes('resultados') || m[0].includes('tabla')) {
      console.log('\n---');
      console.log(m[0].substring(0, 500));
    }
  }
  
  // Find where the search is triggered
  console.log('\n\n=== Search trigger ===');
  const searchTrigger = /.{0,200}(#buscar|buscar424|tabla.draw|tabla.ajax.reload).{0,300}/g;
  while ((m = searchTrigger.exec(js)) !== null) {
    console.log('\n---');
    console.log(m[0].substring(0, 400));
  }
  
  // Find the function that sets up the DataTable for search results
  console.log('\n\n=== tblResultados/resultados setup ===');
  const idx = js.indexOf('"resultados"');
  if (idx > -1) {
    console.log('Context around "resultados":', js.substring(Math.max(0, idx - 500), idx + 500));
  }
}

main().catch(err => console.error('FATAL:', err.message));

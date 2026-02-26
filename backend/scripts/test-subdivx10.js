const axios = require('axios');
const cheerio = require('cheerio');

const FLARESOLVERR_URL = 'http://flaresolverr:8191/v1';
const SESSION_ID = 'subdivx_login_' + Date.now();

async function main() {
  // Create session
  await axios.post(FLARESOLVERR_URL, { cmd: 'sessions.create', session: SESSION_ID });
  console.log('Session created');
  
  try {
    // Step 1: Navigate to main page - solve Cloudflare
    console.log('=== Step 1: Solve Cloudflare ===');
    const mainResp = await axios.post(FLARESOLVERR_URL, {
      cmd: 'request.get',
      url: 'https://www.subdivx.com/',
      session: SESSION_ID,
      maxTimeout: 60000
    });
    console.log('Cookies:', mainResp.data.solution.cookies.map(c => `${c.name}=${c.value.substring(0,20)}...`).join(', '));
    
    // Analyze the main page for login form
    const html = mainResp.data.solution.response;
    const $ = cheerio.load(html);
    
    // Find login form
    const loginForm = $('form').filter((i, el) => {
      const action = $(el).attr('action') || '';
      const html = $(el).html() || '';
      return action.includes('login') || html.includes('login') || html.includes('password') || html.includes('usuario');
    });
    console.log('Login forms found:', loginForm.length);
    loginForm.each((i, el) => {
      console.log(`  Form ${i}: action=${$(el).attr('action')}, method=${$(el).attr('method')}`);
      $(el).find('input').each((j, inp) => {
        console.log(`    Input: name=${$(inp).attr('name')}, type=${$(inp).attr('type')}, id=${$(inp).attr('id')}`);
      });
    });
    
    // Also look for login-related elements
    const loginItems = $('[id*="login"], [id*="Login"], [class*="login"], [class*="Login"], [data-bs-target*="login"], [data-bs-target*="Login"]');
    console.log('\nLogin-related elements:', loginItems.length);
    loginItems.each((i, el) => {
      const tag = el.tagName;
      const id = $(el).attr('id');
      const cls = $(el).attr('class');
      const target = $(el).attr('data-bs-target');
      const href = $(el).attr('href');
      console.log(`  ${tag}: id=${id}, class=${cls?.substring(0,50)}, target=${target}, href=${href}`);
    });
    
    // Look for modal login
    const modals = $('.modal');
    console.log('\nModals:', modals.length);
    modals.each((i, el) => {
      const id = $(el).attr('id');
      console.log(`  Modal: id=${id}`);
      const inputs = $(el).find('input');
      inputs.each((j, inp) => {
        console.log(`    Input: name=${$(inp).attr('name')}, type=${$(inp).attr('type')}, id=${$(inp).attr('id')}, placeholder=${$(inp).attr('placeholder')}`);
      });
    });
    
    // Look for all forms
    console.log('\nAll forms:');
    $('form').each((i, el) => {
      const action = $(el).attr('action') || 'none';
      const id = $(el).attr('id') || 'none';
      const method = $(el).attr('method') || 'none';
      console.log(`  Form: id=${id}, action=${action}, method=${method}`);
    });
    
    // Look for links/buttons that say login/ingresar/entrar
    const loginLinks = $('a, button').filter((i, el) => {
      const text = $(el).text().toLowerCase();
      return text.includes('login') || text.includes('ingresar') || text.includes('entrar') || text.includes('acceder') || text.includes('iniciar');
    });
    console.log('\nLogin links/buttons:', loginLinks.length);
    loginLinks.each((i, el) => {
      console.log(`  ${el.tagName}: text="${$(el).text().trim().substring(0,50)}", href=${$(el).attr('href')}, data-bs-target=${$(el).attr('data-bs-target')}`);
    });
    
    // Search for login in JS
    const loginInJS = html.match(/login|ingresar|acceder/gi);
    if (loginInJS) console.log('\nLogin keywords in page:', [...new Set(loginInJS)]);
    
    // Check for user session (maybe already logged in via SessionID cookie)
    const userNav = $('nav, .navbar').text();
    if (userNav.includes('samu') || userNav.includes('Cerrar') || userNav.includes('logout')) {
      console.log('\n*** POSSIBLY ALREADY LOGGED IN ***');
    }
    
    // Look for data-bs-toggle="modal" buttons
    console.log('\nModal triggers:');
    $('[data-bs-toggle="modal"]').each((i, el) => {
      console.log(`  ${el.tagName}: text="${$(el).text().trim().substring(0,30)}", target=${$(el).attr('data-bs-target')}`);
    });
    
  } finally {
    await axios.post(FLARESOLVERR_URL, { cmd: 'sessions.destroy', session: SESSION_ID }).catch(() => {});
  }
}

main().catch(err => console.error('FATAL:', err.message));

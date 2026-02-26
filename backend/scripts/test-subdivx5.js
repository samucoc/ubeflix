const axios = require('axios');
const cheerio = require('cheerio');

const FLARESOLVERR_URL = 'http://flaresolverr:8191/v1';
let cookies = null;
let userAgent = null;

async function flareRequest(url) {
  const resp = await axios.post(FLARESOLVERR_URL, {
    cmd: 'request.get',
    url,
    maxTimeout: 60000
  });
  cookies = resp.data.solution.cookies;
  userAgent = resp.data.solution.userAgent;
  return resp.data.solution.response;
}

async function directRequest(url, options = {}) {
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const config = {
    url,
    headers: {
      'User-Agent': userAgent,
      'Cookie': cookieStr,
      'Referer': 'https://www.subdivx.com/',
      ...options.headers
    },
    ...options
  };
  return axios(config);
}

async function main() {
  console.log('=== Step 1: Get cookies via FlareSolverr ===');
  await flareRequest('https://www.subdivx.com/');
  console.log('Cookies obtained:', cookies.length);

  console.log('\n=== Step 2: Fetch index-min.js ===');
  const jsResp = await directRequest('https://www.subdivx.com/js/index-min.js?v=4.24');
  const js = jsResp.data;
  console.log('JS length:', js.length);

  // Find searchToken assignment/usage
  console.log('\n=== searchToken contexts ===');
  const tokenRegex = /searchToken[^;]{0,200}/g;
  let m;
  while ((m = tokenRegex.exec(js)) !== null) {
    console.log('  ', m[0]);
  }

  // Find DataTable configuration for tblResultados
  console.log('\n=== tblResultados contexts ===');
  const tblRegex = /tblResultados[^}]{0,500}/g;
  while ((m = tblRegex.exec(js)) !== null) {
    console.log('  ', m[0]);
  }

  // Find the version element "#vs"
  console.log('\n=== #vs contexts ===');
  const vsRegex = /.{0,100}#vs.{0,200}/g;
  while ((m = vsRegex.exec(js)) !== null) {
    console.log('  ', m[0]);
  }

  // Find DataTable ajax config
  console.log('\n=== DataTable ajax config ===');
  const dtAjaxRegex = /ajax:\{[^}]{0,500}/g;
  while ((m = dtAjaxRegex.exec(js)) !== null) {
    console.log('  ', m[0]);
  }

  // Find the actual search/buscar code block
  console.log('\n=== buscar parameter construction ===');
  const buscarRegex = /.{0,100}buscar.{0,300}/g;
  let count = 0;
  while ((m = buscarRegex.exec(js)) !== null && count < 10) {
    if (m[0].includes('buscar"+') || m[0].includes('buscar"]=') || m[0].includes('acession')) {
      console.log('  ', m[0]);
    }
    count++;
  }

  // Find how searchToken is set/obtained
  console.log('\n=== searchToken assignment ===');
  const tokenSetRegex = /searchToken\s*=[^,;]{0,300}/g;
  while ((m = tokenSetRegex.exec(js)) !== null) {
    console.log('  ', m[0]);
  }

  // Find filtros variable
  console.log('\n=== filtros ===');
  const filtrosRegex = /filtros[^;]{0,200}/g;
  let fc = 0;
  while ((m = filtrosRegex.exec(js)) !== null && fc < 10) {
    console.log('  ', m[0]);
    fc++;
  }

  // Now try the actual DataTables AJAX request
  console.log('\n=== Step 3: Try DataTables AJAX request ===');
  
  // First, check if there's a version element on the page
  const pageResp = await directRequest('https://www.subdivx.com/');
  const $ = cheerio.load(pageResp.data);
  const vsElement = $('#vs');
  console.log('#vs element:', vsElement.length ? vsElement.text() : 'NOT FOUND');
  console.log('#vs HTML:', vsElement.length ? vsElement.html() : 'N/A');
  
  // Look for version in the page
  const allElements = $('[id]');
  const ids = [];
  allElements.each((i, el) => {
    const id = $(el).attr('id');
    if (id && (id.includes('vs') || id.includes('version') || id.includes('ver'))) {
      ids.push({ id, text: $(el).text().trim(), tag: el.tagName });
    }
  });
  console.log('Version-related elements:', JSON.stringify(ids));
  
  // Find the version string in the HTML
  const htmlStr = pageResp.data;
  const versionMatches = htmlStr.match(/v\d+\.\d+/g);
  console.log('Version strings in HTML:', [...new Set(versionMatches || [])]);

  // Try the actual AJAX with DataTables format
  const version = '4.24';
  const paramName = 'buscar' + version.replace('.', '').replace('v', '');
  console.log('\nUsing param name:', paramName);
  
  const formData = new URLSearchParams();
  formData.append('draw', '1');
  formData.append('start', '0');
  formData.append('length', '25');
  formData.append(paramName, '28 Days Later');
  formData.append('token', '');
  formData.append('filtros', '');
  
  try {
    const searchResp = await directRequest('https://www.subdivx.com/inc/ajax.php', {
      method: 'POST',
      data: formData.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    console.log('Search response status:', searchResp.status);
    console.log('Search response type:', typeof searchResp.data);
    console.log('Search response length:', JSON.stringify(searchResp.data).length);
    console.log('Search response (first 500):', JSON.stringify(searchResp.data).substring(0, 500));
  } catch (err) {
    console.log('Search error:', err.message);
  }
  
  // Try with acession parameter like old AJAX
  console.log('\n=== Try with acession=buscar ===');
  const formData2 = new URLSearchParams();
  formData2.append('acession', 'buscar');
  formData2.append(paramName, '28 Days Later');
  formData2.append('token', '');
  formData2.append('filtros', '');
  
  try {
    const searchResp2 = await directRequest('https://www.subdivx.com/inc/ajax.php', {
      method: 'POST',
      data: formData2.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    console.log('Search response:', JSON.stringify(searchResp2.data).substring(0, 500));
  } catch (err) {
    console.log('Search error:', err.message);
  }
}

main().catch(err => console.error('FATAL:', err.message));

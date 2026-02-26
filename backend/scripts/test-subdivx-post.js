const axios = require('axios');
const FLARESOLVERR_URL = 'http://flaresolverr:8191/v1';
const SESSION_ID = 'test_' + Date.now();

(async () => {
  await axios.post(FLARESOLVERR_URL, { cmd: 'sessions.create', session: SESSION_ID });
  console.log('Session created');
  
  try {
    // Solve Cloudflare
    const main = await axios.post(FLARESOLVERR_URL, {
      cmd: 'request.get', url: 'https://www.subdivx.com/', session: SESSION_ID, maxTimeout: 60000
    });
    console.log('Cloudflare solved. Cookies:', main.data.solution.cookies.map(c => c.name).join(', '));
    
    // POST with customHeaders 
    const search = await axios.post(FLARESOLVERR_URL, {
      cmd: 'request.post',
      url: 'https://www.subdivx.com/inc/ajax.php',
      session: SESSION_ID,
      maxTimeout: 60000,
      postData: 'tabla=resultados&filtros=&buscar424=28+days+later&token=',
      customHeaders: {
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      }
    });
    
    const body = search.data.solution.response;
    console.log('Response length:', body.length);
    console.log('First 500:', body.substring(0, 500));
    
    // Check for pre tag (Chrome JSON viewer)
    const preMatch = body.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
    if (preMatch) {
      console.log('\n*** Pre content: ***');
      console.log(preMatch[1].substring(0, 1000));
    }
    
    // Check for markers
    if (body.includes('aaData')) console.log('\n*** FOUND aaData! ***');
    if (body.includes('iTotalRecords')) console.log('*** FOUND iTotalRecords! ***');
    if (body.includes('Access') && body.includes('denied')) console.log('*** ACCESS DENIED ***');
    if (body.includes('Just a moment')) console.log('*** CLOUDFLARE CHALLENGE ***');

  } finally {
    await axios.post(FLARESOLVERR_URL, { cmd: 'sessions.destroy', session: SESSION_ID }).catch(() => {});
  }
})();

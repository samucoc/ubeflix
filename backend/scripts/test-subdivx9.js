const axios = require('axios');
const { execSync } = require('child_process');

const FLARESOLVERR_URL = 'http://flaresolverr:8191/v1';

async function main() {
  // Step 1: Get cookies from FlareSolverr
  console.log('=== Step 1: Get cookies ===');
  const resp = await axios.post(FLARESOLVERR_URL, {
    cmd: 'request.get',
    url: 'https://www.subdivx.com/',
    maxTimeout: 60000
  });
  
  const cookies = resp.data.solution.cookies;
  const userAgent = resp.data.solution.userAgent;
  console.log('Cookies:', cookies.map(c => `${c.name}=${c.value}`).join('; '));
  console.log('UA:', userAgent);
  
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  
  // Step 2: Try curl with impersonation
  console.log('\n=== Step 2: curl AJAX request ===');
  const curlCmd = `curl -s -w "\\nHTTP_CODE:%{http_code}" \
    -X POST 'https://www.subdivx.com/inc/ajax.php' \
    -H 'User-Agent: ${userAgent}' \
    -H 'Cookie: ${cookieStr}' \
    -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' \
    -H 'X-Requested-With: XMLHttpRequest' \
    -H 'Referer: https://www.subdivx.com/' \
    -H 'Origin: https://www.subdivx.com' \
    -H 'Accept: application/json, text/javascript, */*; q=0.01' \
    -H 'Accept-Language: es-AR,es;q=0.9,en;q=0.8' \
    -H 'Sec-Ch-Ua: "Chromium";v="142", "Not=A?Brand";v="99"' \
    -H 'Sec-Ch-Ua-Mobile: ?0' \
    -H 'Sec-Ch-Ua-Platform: "Linux"' \
    -H 'Sec-Fetch-Dest: empty' \
    -H 'Sec-Fetch-Mode: cors' \
    -H 'Sec-Fetch-Site: same-origin' \
    --data-urlencode 'draw=1' \
    --data-urlencode 'start=0' \
    --data-urlencode 'length=25' \
    --data-urlencode 'tabla=resultados' \
    --data-urlencode 'buscar424=28 Days Later' \
    --data-urlencode 'token=' \
    --data-urlencode 'filtros=' \
    --max-time 30 2>&1`;
  
  try {
    const result = execSync(curlCmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    const lines = result.split('\n');
    const httpCodeLine = lines.find(l => l.startsWith('HTTP_CODE:'));
    const httpCode = httpCodeLine ? httpCodeLine.replace('HTTP_CODE:', '') : 'unknown';
    const body = lines.filter(l => !l.startsWith('HTTP_CODE:')).join('\n');
    
    console.log('HTTP Code:', httpCode);
    console.log('Body length:', body.length);
    console.log('Body (first 1000):', body.substring(0, 1000));
    
    if (body.trim()) {
      try {
        const json = JSON.parse(body.trim());
        console.log('\nJSON keys:', Object.keys(json));
        if (json.data) {
          console.log('Results:', json.data.length);
          if (json.data.length > 0) console.log('First:', JSON.stringify(json.data[0]).substring(0, 400));
        }
        if (json.token) console.log('Token:', json.token);
        if (json.recordsTotal !== undefined) console.log('Total:', json.recordsTotal);
      } catch (e) {
        // Not JSON
      }
    }
  } catch (e) {
    console.log('Curl error:', e.message.substring(0, 500));
  }
  
  // Step 3: Maybe we need to also GET the page first with curl to setup the session
  console.log('\n=== Step 3: curl GET then POST ===');
  const curlCmd2 = `curl -s -c /tmp/sdx_cookies.txt -b /tmp/sdx_cookies.txt \
    -H 'User-Agent: ${userAgent}' \
    -H 'Cookie: ${cookieStr}' \
    'https://www.subdivx.com/' -o /dev/null -w "GET:%{http_code}\\n" && \
  curl -s -b /tmp/sdx_cookies.txt \
    -X POST 'https://www.subdivx.com/inc/ajax.php' \
    -H 'User-Agent: ${userAgent}' \
    -H 'Cookie: ${cookieStr}' \
    -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' \
    -H 'X-Requested-With: XMLHttpRequest' \
    -H 'Referer: https://www.subdivx.com/' \
    -H 'Origin: https://www.subdivx.com' \
    -H 'Accept: application/json, text/javascript, */*; q=0.01' \
    -d 'draw=1&start=0&length=25&tabla=resultados&buscar424=28+Days+Later&token=&filtros=' \
    -w "\\nPOST:%{http_code}" --max-time 30 2>&1`;
  
  try {
    const result2 = execSync(curlCmd2, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    console.log('Result:', result2.substring(0, 1000));
  } catch (e) {
    console.log('Curl2 error:', e.message.substring(0, 500));
  }
}

main().catch(err => console.error('FATAL:', err.message));

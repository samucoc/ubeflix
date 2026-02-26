const axios = require('axios');

const FLARESOLVERR_URL = 'http://flaresolverr:8191/v1';

async function main() {
  console.log('=== Search via FlareSolverr POST ===');
  
  // Use FlareSolverr to POST to ajax.php with DataTables params
  const postData = 'draw=1&start=0&length=25&tabla=resultados&buscar424=28+Days+Later&token=&filtros=';
  
  try {
    const resp = await axios.post(FLARESOLVERR_URL, {
      cmd: 'request.post',
      url: 'https://www.subdivx.com/inc/ajax.php',
      maxTimeout: 60000,
      postData: postData
    });
    
    console.log('Status:', resp.data.status);
    console.log('Solution status:', resp.data.solution.status);
    const body = resp.data.solution.response;
    console.log('Response length:', body.length);
    console.log('Response (first 1000):', body.substring(0, 1000));
    
    // Try to parse as JSON
    try {
      // The response might be wrapped in HTML, try to extract JSON
      const jsonMatch = body.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        console.log('\nParsed JSON keys:', Object.keys(data));
        if (data.data) {
          console.log('Results count:', data.data.length);
          if (data.data.length > 0) {
            console.log('First result:', JSON.stringify(data.data[0]).substring(0, 500));
          }
        }
        if (data.token) {
          console.log('Token:', data.token);
        }
        if (data.recordsTotal) {
          console.log('Total records:', data.recordsTotal);
        }
      }
    } catch (e) {
      console.log('Not JSON, checking HTML...');
      // Maybe it's a Cloudflare challenge page
      if (body.includes('Just a moment')) {
        console.log('Got Cloudflare challenge page');
      }
    }
  } catch (err) {
    console.log('Error:', err.message);
    if (err.response) {
      console.log('Response data:', JSON.stringify(err.response.data).substring(0, 500));
    }
  }

  // Also try with proper DataTables columns format
  console.log('\n=== Try with full DataTables structure ===');
  const params = new URLSearchParams();
  params.append('draw', '1');
  params.append('columns[0][data]', '0');
  params.append('columns[0][searchable]', 'true');
  params.append('columns[0][orderable]', 'true');
  params.append('start', '0');
  params.append('length', '25');
  params.append('tabla', 'resultados');
  params.append('buscar424', '28 Days Later');
  params.append('token', '');
  params.append('filtros', '');
  
  try {
    const resp = await axios.post(FLARESOLVERR_URL, {
      cmd: 'request.post',
      url: 'https://www.subdivx.com/inc/ajax.php',
      maxTimeout: 60000,
      postData: params.toString()
    });
    
    console.log('Status:', resp.data.status);
    const body = resp.data.solution.response;
    console.log('Response length:', body.length);
    console.log('Response (first 1000):', body.substring(0, 1000));
    
    try {
      const jsonMatch = body.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        console.log('Parsed JSON keys:', Object.keys(data));
        if (data.data) {
          console.log('Results count:', data.data.length);
          if (data.data.length > 0) {
            console.log('First result:', JSON.stringify(data.data[0]).substring(0, 500));
          }
        }
        if (data.token) console.log('Token:', data.token);
        if (data.recordsTotal) console.log('Total records:', data.recordsTotal);
        if (data.mensaje) console.log('Mensaje:', data.mensaje);
      }
    } catch (e) {
      console.log('Parse error');
    }
  } catch (err) {
    console.log('Error:', err.message);
  }
}

main().catch(err => console.error('FATAL:', err.message));

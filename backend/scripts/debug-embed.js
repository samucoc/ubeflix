const axios = require('axios');

async function main() {
  const playlistId = '1Iu6MIqVDwaQrumgJaL1M2';
  
  console.log('Fetching embed page...');
  const res = await axios.get(`https://open.spotify.com/embed/playlist/${playlistId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });

  const re = /id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s;
  const match = res.data.match(re);

  if (!match) {
    console.log('No __NEXT_DATA__ found!');
    // Check if there's any script tags
    const scripts = res.data.match(/<script[^>]*>([\s\S]*?)<\/script>/g);
    console.log(`Found ${scripts?.length || 0} script tags`);
    if (scripts) {
      for (const s of scripts) {
        console.log('Script preview:', s.substring(0, 200));
      }
    }
    return;
  }

  const json = JSON.parse(match[1]);
  
  // Print top-level keys
  console.log('\nTop keys:', Object.keys(json));
  console.log('props keys:', Object.keys(json.props || {}));
  console.log('pageProps keys:', Object.keys(json.props?.pageProps || {}));
  
  // Check state
  const state = json.props?.pageProps?.state;
  if (state) {
    console.log('state keys:', Object.keys(state));
    if (state.data) {
      console.log('state.data keys:', Object.keys(state.data));
      if (state.data.entity) {
        console.log('entity keys:', Object.keys(state.data.entity));
        console.log('entity.trackList length:', state.data.entity.trackList?.length);
      }
    }
  }
  
  // Deep search for trackList and accessToken
  function findKey(obj, key, path = '', depth = 0) {
    if (depth > 10 || !obj || typeof obj !== 'object') return;
    if (obj[key] !== undefined) {
      const val = obj[key];
      const preview = typeof val === 'string' ? val.substring(0, 80) : 
                      Array.isArray(val) ? `Array(${val.length})` : typeof val;
      console.log(`Found "${key}" at ${path}: ${preview}`);
    }
    for (const k of Object.keys(obj)) {
      findKey(obj[k], key, `${path}.${k}`, depth + 1);
    }
  }
  
  console.log('\n--- Searching for trackList ---');
  findKey(json, 'trackList', 'root');
  
  console.log('\n--- Searching for accessToken ---');
  findKey(json, 'accessToken', 'root');
  
  console.log('\n--- Searching for tracks ---');
  findKey(json, 'tracks', 'root');
  
  console.log('\n--- Searching for items ---');
  findKey(json, 'items', 'root');

  // Also dump pageProps keys at different levels
  const pp = json.props?.pageProps;
  if (pp) {
    for (const k of Object.keys(pp)) {
      const v = pp[k];
      const preview = typeof v === 'string' ? v.substring(0, 100) :
                      Array.isArray(v) ? `Array(${v.length})` :
                      typeof v === 'object' && v ? `{${Object.keys(v).join(',')}}` : String(v);
      console.log(`pageProps.${k}: ${preview}`);
    }
  }
}

main().catch(e => console.error(e.message));

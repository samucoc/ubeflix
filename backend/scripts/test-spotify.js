const axios = require('axios');

async function test() {
  const embedRes = await axios.get('https://open.spotify.com/embed/playlist/2gq2GLEhH2RRzP50B8NzZL');
  const re = /id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s;
  const m = embedRes.data.match(re);
  const json = JSON.parse(m[1]);
  
  // Deep search for accessToken
  function findKey(obj, key, depth = 0) {
    if (depth > 6 || !obj || typeof obj !== 'object') return null;
    if (obj[key]) return obj[key];
    for (const k of Object.keys(obj)) {
      const found = findKey(obj[k], key, depth + 1);
      if (found) return found;
    }
    return null;
  }
  
  const token = findKey(json?.props?.pageProps, 'accessToken');
  console.log('Token found:', token ? 'yes' : 'no');
  
  if (token) {
    let offset = 0;
    let total = null;
    let allTracks = [];
    
    while (total === null || offset < total) {
      const url = `https://api.spotify.com/v1/playlists/2gq2GLEhH2RRzP50B8NzZL/tracks?offset=${offset}&limit=100`;
      const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
      total = res.data.total;
      allTracks.push(...res.data.items);
      console.log(`Offset ${offset}: got ${res.data.items.length} (total: ${total})`);
      offset += 100;
    }
    
    console.log('TOTAL tracks:', allTracks.length);
    console.log('First:', allTracks[0]?.track?.name, '-', allTracks[0]?.track?.artists?.[0]?.name);
    console.log('Last:', allTracks[allTracks.length-1]?.track?.name);
  }
}

test().catch(e => console.log('ERR:', e.response?.status, e.response?.data?.error?.message || e.message));

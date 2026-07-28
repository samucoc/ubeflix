const axios = require('axios');

async function main() {
  const id = '2gq2GLEhH2RRzP50B8NzZL';

  // Get embed token
  const res = await axios.get(`https://open.spotify.com/embed/playlist/${id}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const re = /id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s;
  const m = res.data.match(re);
  const json = JSON.parse(m[1]);
  
  function findKey(obj, key, d) {
    d = d || 0;
    if (d > 12 || !obj || typeof obj !== 'object') return undefined;
    if (obj[key] !== undefined) return obj[key];
    for (const k of Object.keys(obj)) {
      const r = findKey(obj[k], key, d + 1);
      if (r !== undefined) return r;
    }
    return undefined;
  }

  const tok = findKey(json.props?.pageProps, 'accessToken');
  console.log('Token:', tok ? 'yes' : 'no');

  // Use embed token to get playlist total
  try {
    const apiRes = await axios.get(`https://api.spotify.com/v1/playlists/${id}?fields=name,tracks(total)`, {
      headers: { Authorization: `Bearer ${tok}` }
    });
    console.log('API result:', JSON.stringify(apiRes.data));
  } catch (e) {
    console.log('API fields error:', e.response?.status, e.response?.data?.error?.message);
  }

  // Also try tracks endpoint directly to see total
  try {
    const tracksRes = await axios.get(`https://api.spotify.com/v1/playlists/${id}/tracks`, {
      params: { offset: 0, limit: 1, fields: 'total,next' },
      headers: { Authorization: `Bearer ${tok}` }
    });
    console.log('Tracks total:', tracksRes.data.total);
    console.log('Tracks next:', tracksRes.data.next ? 'yes' : 'no');
  } catch (e) {
    console.log('Tracks error:', e.response?.status, e.response?.data?.error?.message);
  }

  // Paginate all
  let offset = 0;
  let total = 0;
  let count = 0;
  while (true) {
    try {
      const page = await axios.get(`https://api.spotify.com/v1/playlists/${id}/tracks`, {
        params: { offset, limit: 100, fields: 'items(track(id,name)),total,next' },
        headers: { Authorization: `Bearer ${tok}` }
      });
      total = page.data.total;
      const items = page.data.items || [];
      count += items.length;
      console.log(`offset=${offset}: +${items.length} items (${count}/${total})`);
      if (!page.data.next || items.length === 0) break;
      offset += 100;
    } catch (e) {
      console.log('Page error at offset', offset, ':', e.response?.status);
      break;
    }
  }
  console.log(`\nTOTAL: ${count} tracks fetched of ${total}`);
}

main().catch(e => console.log('Error:', e.message));

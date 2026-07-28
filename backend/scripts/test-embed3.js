const axios = require('axios');

async function main() {
  const id = '2gq2GLEhH2RRzP50B8NzZL';

  // 1. Test embed
  console.log('=== EMBED TEST ===');
  const res = await axios.get(`https://open.spotify.com/embed/playlist/${id}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const re = /id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s;
  const m = res.data.match(re);
  if (!m) { console.log('No NEXT_DATA'); return; }

  const json = JSON.parse(m[1]);
  const pp = json.props?.pageProps;
  console.log('status:', pp?.status);
  const entity = pp?.state?.data?.entity;
  if (entity) {
    console.log('name:', entity.name);
    console.log('trackList:', entity.trackList?.length);
    console.log('trackCount:', entity.trackCount);
  } else {
    console.log('No entity - title:', pp?.title);
    return;
  }

  // 2. Buscar accessToken
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

  const tok = findKey(pp, 'accessToken');
  console.log('embedToken:', tok ? 'YES (' + tok.substring(0, 30) + '...)' : 'NO');

  // 3. Si hay token y faltan tracks, probar paginación
  if (tok && entity.trackList?.length < (entity.trackCount || 0)) {
    const offset = entity.trackList.length;
    console.log(`\n=== PAGINATION TEST (offset=${offset}) ===`);
    try {
      const apiRes = await axios.get(`https://api.spotify.com/v1/playlists/${id}/tracks`, {
        params: { offset, limit: 100, fields: 'items(track(id,name,artists)),total,next' },
        headers: { Authorization: `Bearer ${tok}` }
      });
      console.log('total:', apiRes.data.total);
      console.log('items:', apiRes.data.items?.length);
      console.log('next:', apiRes.data.next ? 'yes' : 'no');
      if (apiRes.data.items?.length > 0) {
        const first = apiRes.data.items[0].track;
        console.log('first track:', first?.name, '-', first?.artists?.[0]?.name);
      }
    } catch (e) {
      console.log('Pagination error:', e.response?.status, e.response?.data?.error?.message || e.message);
    }
  }
}

main().catch(e => console.log('Error:', e.message));

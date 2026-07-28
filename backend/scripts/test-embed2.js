const axios = require('axios');

async function test() {
  // Test con Top 50 Global (playlist muy pública)
  const testId = '37i9dQZEVXbMDoHDwVN2tF';
  const origId = '1Iu6MIqVDwaQrumgJaL1M2';

  for (const id of [testId, origId]) {
    console.log(`\n=== Testing playlist: ${id} ===`);
    try {
      const res = await axios.get(`https://open.spotify.com/embed/playlist/${id}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });

      const re = /id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s;
      const m = res.data.match(re);
      if (!m) { console.log('No __NEXT_DATA__'); continue; }

      const json = JSON.parse(m[1]);
      const pp = json.props?.pageProps;
      console.log('pageProps.status:', pp?.status);

      const entity = pp?.state?.data?.entity;
      if (entity) {
        console.log('name:', entity.name);
        console.log('trackList length:', entity.trackList?.length);
      } else {
        console.log('No entity found');
        console.log('pageProps keys:', Object.keys(pp));
        if (pp.title) console.log('title:', pp.title);
      }
    } catch (e) {
      console.log('Error:', e.response?.status, e.message);
    }
  }
}

test();

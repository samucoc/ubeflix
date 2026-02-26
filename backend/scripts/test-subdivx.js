const axios = require('axios');
const cheerio = require('cheerio');

(async () => {
  try {
    // Get existing session or create new one
    let session;
    try {
      const sr = await axios.post('http://flaresolverr:8191/v1', { cmd: 'sessions.create' }, { timeout: 30000 });
      session = sr.data.session;
    } catch {}

    const r = await axios.post('http://flaresolverr:8191/v1', {
      cmd: 'request.get',
      url: 'https://www.subdivx.com/?buscar=28+Days+Later&acession=buscar',
      maxTimeout: 60000,
      ...(session && { session }),
    }, { timeout: 90000 });

    const html = r.data.solution?.response || '';
    console.log('HTML Length:', html.length);

    const ch = cheerio.load(html);
    console.log('Title:', ch('title').text());

    // Check various selectors
    console.log('.titulo_menu_izq:', ch('.titulo_menu_izq').length);
    console.log('.title_news_1:', ch('.title_news_1').length);
    console.log('a[href*=X27]:', ch('a[href*="X27"]').length);
    console.log('.card:', ch('.card').length);
    console.log('.list-group-item:', ch('.list-group-item').length);

    // Print all links that look interesting
    const links = [];
    ch('a').each((i, el) => {
      const href = ch(el).attr('href') || '';
      const text = ch(el).text().trim().substring(0, 80);
      if (href.length > 10 && text.length > 3 && !href.startsWith('#') && !href.includes('javascript')) {
        links.push({ href: href.substring(0, 120), text });
      }
    });
    console.log('\nInteresting links:', links.length);
    links.slice(0, 30).forEach(l => console.log(`  ${l.href}\n    "${l.text}"`));

    // Print all element classes to find the structure
    const classes = new Set();
    ch('[class]').each((i, el) => {
      const cls = ch(el).attr('class');
      if (cls) cls.split(/\s+/).forEach(c => classes.add(c));
    });
    console.log('\nAll CSS classes:', Array.from(classes).sort().join(', '));

  } catch (e) {
    console.error('Error:', e.message);
  }
})();

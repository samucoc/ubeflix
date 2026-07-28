const express = require('express');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const net = require('net');
const dns = require('dns').promises;

const router = express.Router();

// The proxy used to forward any URL an authenticated user asked for, which made
// it an SSRF pivot into the Docker network (db:5432, the remount agent on
// localhost:9797, …). Now only URLs this server itself produced — when
// rewriting a playlist — are accepted, proven by an HMAC over the URL.
const LIVETV_PROXY_KEY = crypto
  .createHmac('sha256', process.env.JWT_SECRET)
  .update('livetv-proxy-v1')
  .digest();

function signProxyUrl(url) {
  return crypto.createHmac('sha256', LIVETV_PROXY_KEY).update(url).digest('base64url');
}

function verifyProxyUrl(url, signature) {
  if (typeof url !== 'string' || typeof signature !== 'string' || !signature) return false;
  const expected = Buffer.from(signProxyUrl(url));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

function proxyPathFor(absoluteUrl) {
  return `/api/livetv/proxy?url=${encodeURIComponent(absoluteUrl)}&sig=${signProxyUrl(absoluteUrl)}`;
}

// Defence in depth for the hops we don't control: a signed playlist URL may
// still redirect somewhere internal, and the la14hd scrape returns a URL from a
// third party. Refuse to connect to anything that resolves to a private range.
function isBlockedAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;            // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;  // CGNAT
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('::ffff:')) return isBlockedAddress(lower.slice(7)); // IPv4-mapped
    if (/^f[cd]/.test(lower)) return true;              // unique local
    if (lower.startsWith('fe80')) return true;          // link-local
    return false;
  }
  return true; // unparseable → refuse
}

async function assertPublicDestination(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('URL inválida');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Protocolo no permitido');
  }

  const literal = parsed.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(literal)) {
    if (isBlockedAddress(literal)) throw new Error('Destino interno bloqueado');
    return;
  }

  const addresses = await dns.lookup(literal, { all: true });
  if (addresses.length === 0) throw new Error('No se pudo resolver el host');
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) throw new Error('Destino interno bloqueado');
  }
}

const LIVETV_CHANNELS = {
  // --- Canales nacionales ---
  tvn:  { name: 'TVN',     youtube: '@TVN_Chile' },
  '13': { name: 'Canal 13', url: 'https://redirector.dps.live/hls/13cl/playlist.m3u8' },
  chv:  { name: 'CHV',     url: 'https://redirector.rudo.video/hls-video/10b92cafdf3646cbc1e727f3dc76863621a327fd/chv/chv.smil/playlist.m3u8' },
  mega: { name: 'Mega',    url: 'https://unlimited2-cl-isp.dps.live/mega/mega.smil/playlist.m3u8' },
  tvmas: { name: 'TV+',    url: 'https://jireh-8-hls-video-us-isp.dps.live/hls-video/ey6283je82983je9823je8jowowiekldk9838274/tvmas/tvmas.smil/playlist.m3u8' },
  zonalatina: { name: 'Zona Latina', youtube: '@canalzonalatina' },
  // --- Canales de noticias ---
  '24h':   { name: '24 Horas',      youtube: '@24Horas_TVNChile' },
  t13:     { name: 'T13',           url: 'https://redirector.dps.live/hls/t13/playlist.m3u8' },
  chvn:    { name: 'CHV Noticias',  url: 'https://redirector.dps.live/hls/chvn/playlist.m3u8' },
  meganot: { name: 'Meganoticias',  youtube: '@meganoticiasoficial' },
  cnnchile: { name: 'CNN Chile',    url: 'https://redirector.rudo.video/hls-video/339f69c6122f6d8f4574732c235f09b7683e31a5/cnn/cnn.smil/playlist.m3u8' },
  biobio:   { name: 'Bío Bío TV',   url: 'https://redirector.rudo.video/hls-video/339f69c6122f6d8f4574732c235f09b7683e31a5/bbtv/bbtv.smil/playlist.m3u8' },
  // --- Canales deportivos ---
  '13dep':   { name: '13 Deportes', url: 'https://origin.dpsgo.com/ssai/event/uFiYkh4CQPCPgbs7WPKhXw/master.m3u8' },
  '13futgo': { name: '13 FutGO',    url: 'https://origin.dpsgo.com/ssai/event/Jxo4ZkwHQr-9XqguRcdsSg/master.m3u8' },
  espn:      { name: 'ESPN',              scrape: 'espn' },
  espn2:     { name: 'ESPN 2',            scrape: 'espn2' },
  espn3:     { name: 'ESPN 3',            scrape: 'espn3' },
  espn4:     { name: 'ESPN 4',            scrape: 'espn4' },
  espn5:     { name: 'ESPN 5',            scrape: 'espn5' },
  espn6:     { name: 'ESPN 6',            scrape: 'espn6' },
  espn7:     { name: 'ESPN 7',            scrape: 'espn7' },
  espnprem:  { name: 'ESPN Premium',      scrape: 'espnpremium' },
  tntsports: { name: 'TNT Sports',        scrape: 'tntsports' },
};

// Scrape stream URL from la14hd.com (with cache)
const scrapedStreamCache = {};
function scrapeStreamUrl(streamName) {
  return new Promise((resolve, reject) => {
    const cached = scrapedStreamCache[streamName];
    if (cached && Date.now() - cached.ts < 2 * 60 * 60 * 1000) {
      return resolve(cached.url);
    }
    const pageUrl = `https://la14hd.com/vivo/canal.php?stream=${streamName}`;
    https.get(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      timeout: 15000,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        const match = body.match(/var\s+playbackURL\s*=\s*"([^"]+)"/);
        if (match) {
          scrapedStreamCache[streamName] = { url: match[1], ts: Date.now() };
          console.log(`[LiveTV] Scraped ${streamName}: ${match[1].substring(0, 80)}...`);
          resolve(match[1]);
        } else {
          reject(new Error('No se encontró URL del stream en la página'));
        }
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

// Follow redirects helper (up to 5 hops)
function fetchWithRedirects(url, maxRedirects, callback) {
  if (maxRedirects <= 0) return callback(new Error('Too many redirects'));

  // Every hop is re-checked: only the first URL carries our signature.
  assertPublicDestination(url).then(() => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': parsedUrl.origin + '/',
      },
      timeout: 10000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); // drain
        // Location may be relative — resolve against the URL we just fetched.
        const nextUrl = new URL(res.headers.location, url).toString();
        return fetchWithRedirects(nextUrl, maxRedirects - 1, callback);
      }
      callback(null, res, url);
    });
    req.on('error', (err) => callback(err));
    req.on('timeout', () => { req.destroy(); callback(new Error('timeout')); });
  }).catch(callback);
}

// Resolve YouTube live channel handle to video ID (with cache)
const ytVideoIdCache = {};
function getYouTubeVideoId(channelHandle) {
  return new Promise((resolve, reject) => {
    const cached = ytVideoIdCache[channelHandle];
    if (cached && Date.now() - cached.ts < 10 * 60 * 1000) {
      return resolve(cached.videoId);
    }

    const ytUrl = `https://www.youtube.com/${channelHandle}/live`;
    const fetchPage = (url) => {
      const req = https.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 15000,
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return fetchPage(res.headers.location);
        }
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          const match = body.match(/"videoId":"([^"]+)"/);
          if (match) {
            ytVideoIdCache[channelHandle] = { videoId: match[1], ts: Date.now() };
            resolve(match[1]);
          } else {
            reject(new Error('No live stream found'));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    };
    fetchPage(ytUrl);
  });
}

// Rewrite m3u8 content: make ALL URLs go through our proxy
function rewriteM3u8(body, finalUrl) {
  const baseUrl = finalUrl.substring(0, finalUrl.lastIndexOf('/') + 1);
  return body.replace(/^(?!#)(.+)$/gm, (match) => {
    const trimmed = match.trim();
    if (!trimmed) return match;
    // Resolve to absolute URL
    const absolute = trimmed.startsWith('http') ? trimmed : baseUrl + trimmed;
    // Route through our proxy, signed so it can't be swapped for another target
    return proxyPathFor(absolute);
  }).replace(/(URI=")((?!data:)[^"]+)(")/g, (match, pre, uri, post) => {
    const absolute = uri.startsWith('http') ? uri : baseUrl + uri;
    return pre + proxyPathFor(absolute) + post;
  });
}

router.get('/channels', (req, res) => {
  const list = Object.entries(LIVETV_CHANNELS).map(([id, ch]) => ({
    id, name: ch.name, type: ch.youtube ? 'youtube' : 'hls',
  }));
  res.json(list);
});

// Resolve YouTube live video ID for embed
router.get('/youtube/:channelId', (req, res) => {
  const channel = LIVETV_CHANNELS[req.params.channelId];
  if (!channel || !channel.youtube) {
    return res.status(404).json({ error: 'Canal no encontrado' });
  }
  getYouTubeVideoId(channel.youtube)
    .then(videoId => res.json({ videoId }))
    .catch(err => {
      console.error(`YouTube resolve error for ${req.params.channelId}:`, err.message);
      res.status(502).json({ error: 'Canal de YouTube no está en vivo' });
    });
});

// Generic proxy endpoint for sub-playlists and segments
router.get('/proxy', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Only URLs we signed while rewriting a playlist are proxied.
  if (!verifyProxyUrl(targetUrl, req.query.sig)) {
    console.warn(`[livetv] proxy rechazado (firma inválida): ${String(targetUrl).slice(0, 120)}`);
    return res.status(403).json({ error: 'URL no autorizada' });
  }

  fetchWithRedirects(targetUrl, 5, (err, proxyRes, finalUrl) => {
    if (err) {
      console.error(`LiveTV proxy error:`, err.message);
      if (!res.headersSent) res.status(502).json({ error: 'Proxy error' });
      return;
    }

    if (proxyRes.statusCode !== 200) {
      let body = '';
      proxyRes.on('data', (chunk) => { body += chunk; });
      proxyRes.on('end', () => {
        if (!res.headersSent) res.status(proxyRes.statusCode).end(body);
      });
      return;
    }

    const ct = proxyRes.headers['content-type'] || '';
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');

    // If it's an m3u8 playlist, rewrite URLs to go through proxy
    if (ct.includes('mpegurl') || ct.includes('application/vnd.apple') || finalUrl.includes('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      let body = '';
      proxyRes.on('data', (chunk) => { body += chunk; });
      proxyRes.on('end', () => {
        res.end(rewriteM3u8(body, finalUrl));
      });
    } else {
      // Binary segments (.ts, .aac, etc.) — pipe directly
      if (proxyRes.headers['content-type']) res.setHeader('Content-Type', proxyRes.headers['content-type']);
      if (proxyRes.headers['content-length']) res.setHeader('Content-Length', proxyRes.headers['content-length']);
      proxyRes.pipe(res);
    }
  });
});

router.get('/stream/:channelId', (req, res) => {
  const { channelId } = req.params;
  const channel = LIVETV_CHANNELS[channelId];
  if (!channel) {
    return res.status(404).json({ error: 'Canal no encontrado' });
  }

  // YouTube channels are handled via embed, not HLS proxy
  if (channel.youtube) {
    return res.status(400).json({ error: 'Canal de YouTube usa embed, no HLS proxy' });
  }

  // For scraped channels, resolve URL dynamically
  const startStream = (streamUrl) => {
    fetchWithRedirects(streamUrl, 5, (err, proxyRes, finalUrl) => {
      if (err) {
        console.error(`LiveTV proxy error for ${channelId}:`, err.message);
        if (!res.headersSent) {
          res.status(502).json({ error: 'No se pudo conectar al canal' });
        }
        return;
      }

    if (proxyRes.statusCode !== 200) {
      let body = '';
      proxyRes.on('data', (chunk) => { body += chunk; });
      proxyRes.on('end', () => {
        console.error(`LiveTV ${channelId}: HTTP ${proxyRes.statusCode} - ${body.substring(0, 200)}`);
        if (!res.headersSent) {
          res.status(502).json({ error: `Canal respondió con error ${proxyRes.statusCode}` });
        }
      });
      return;
    }

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');

    let body = '';
    proxyRes.on('data', (chunk) => { body += chunk; });
    proxyRes.on('end', () => {
      res.end(rewriteM3u8(body, finalUrl));
    });
    });
  };

  if (channel.scrape) {
    scrapeStreamUrl(channel.scrape)
      .then(url => startStream(url))
      .catch(err => {
        console.error(`Scrape error for ${channelId}:`, err.message);
        if (!res.headersSent) res.status(502).json({ error: 'No se pudo obtener URL del canal' });
      });
  } else {
    startStream(channel.url);
  }
});

module.exports = router;

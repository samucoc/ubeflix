// Arranca el backend real y verifica los fixes de LFI y SSRF.
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SECRET = 'test-secret-para-chequeo-de-seguridad';
const PORT = 5599;

// VIDEOS_PATH actúa como raíz permitida; metemos una imagen legítima dentro.
const videosDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubeflix-videos-'));
fs.writeFileSync(path.join(videosDir, 'poster.jpg'), 'fake-jpeg');
// Y una imagen FUERA de cualquier raíz permitida.
const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubeflix-outside-'));
const outsideImage = path.join(outsideDir, 'robada.jpg');
fs.writeFileSync(outsideImage, 'no-deberia-servirse');

const token = jwt.sign({ id: 1, username: 'test', is_admin: true }, SECRET, { expiresIn: '1h' });
const auth = { Authorization: `Bearer ${token}` };

// Reproduce la firma del servidor (lo que hace al reescribir un playlist).
const proxyKey = crypto.createHmac('sha256', SECRET).update('livetv-proxy-v1').digest();
const sign = (url) => crypto.createHmac('sha256', proxyKey).update(url).digest('base64url');

const server = spawn(process.execPath, ['src/index.js'], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, JWT_SECRET: SECRET, PORT: String(PORT), VIDEOS_PATH: videosDir, DB_HOST: '127.0.0.1', DB_PORT: '1', MIGRATIONS_RETRY_ATTEMPTS: '1', NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

const get = (pathAndQuery) =>
  fetch(`http://127.0.0.1:${PORT}${pathAndQuery}`, { headers: auth })
    .then((r) => r.status)
    .catch(() => 0);

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

(async () => {
  if (!(await waitForServer())) {
    console.error('❌ El servidor no arrancó.\n', serverLog.slice(-2000));
    server.kill();
    process.exit(1);
  }

  const checks = [];
  const check = (name, actual, expected) =>
    checks.push([name, actual === expected, `esperado ${expected}, recibido ${actual}`]);

  // ── LFI ────────────────────────────────────────────────────────────────
  check('sin auth -> 401', await fetch(`http://127.0.0.1:${PORT}/api/images//etc/passwd`).then(r => r.status), 401);
  check('/etc/passwd -> 400', await get('/api/images//etc/passwd'), 400);
  check('/etc/passwd.jpg (extension valida) -> 403', await get('/api/images//etc/passwd.jpg'), 403);
  check('imagen fuera de las raices -> 403', await get('/api/images/' + encodeURI(outsideImage)), 403);
  check('traversal a raiz permitida -> 403',
    await get('/api/images/' + encodeURI(path.join(videosDir, '..', '..', 'etc', 'passwd.jpg'))), 403);
  check('poster legitimo dentro de VIDEOS_PATH -> 200',
    await get('/api/images/' + encodeURI(path.join(videosDir, 'poster.jpg'))), 200);

  // ── SSRF ───────────────────────────────────────────────────────────────
  const internal = 'http://localhost:9797/remount';
  check('proxy sin firma -> 403', await get('/api/livetv/proxy?url=' + encodeURIComponent(internal)), 403);
  check('proxy con firma falsa -> 403',
    await get('/api/livetv/proxy?url=' + encodeURIComponent(internal) + '&sig=deadbeef'), 403);
  check('proxy a db:5432 sin firma -> 403',
    await get('/api/livetv/proxy?url=' + encodeURIComponent('http://db:5432/')), 403);
  // Firmada correctamente pero apuntando a un destino interno: lo corta el chequeo de IP.
  check('URL firmada hacia destino interno -> 502',
    await get('/api/livetv/proxy?url=' + encodeURIComponent(internal) + '&sig=' + sign(internal)), 502);
  check('URL firmada hacia metadata cloud -> 502',
    await get('/api/livetv/proxy?url=' + encodeURIComponent('http://169.254.169.254/latest/meta-data/') +
      '&sig=' + sign('http://169.254.169.254/latest/meta-data/')), 502);

  let ok = true;
  for (const [name, pass, detail] of checks) {
    console.log(`${pass ? '✅' : '❌'} ${name}${pass ? '' : ' — ' + detail}`);
    if (!pass) ok = false;
  }

  if (!ok) console.error('\n--- log del servidor ---\n' + serverLog.slice(-3000));
  server.kill();
  fs.rmSync(videosDir, { recursive: true, force: true });
  fs.rmSync(outsideDir, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
})();

// Los tokens de media deben servir para reproducir y para nada más.
// También cubre la validación de ids de ruta y el parser de rangos.
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseRangeHeader } = require('../src/utils/streamFile');
const { parseNumericId } = require('../src/utils/params');

const SECRET = 'test-secret-media-token';
const PORT = 5603;

const videosDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubeflix-media-'));
fs.writeFileSync(path.join(videosDir, 'poster.jpg'), 'fake-jpeg');
const posterPath = path.join(videosDir, 'poster.jpg');

const accessToken = jwt.sign({ id: 1, username: 'admin', is_admin: true, type: 'access' }, SECRET, { expiresIn: '1h' });
const mediaToken = jwt.sign({ id: 1, type: 'media' }, SECRET, { expiresIn: '1h' });

const server = spawn(process.execPath, ['src/index.js'], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env, JWT_SECRET: SECRET, PORT: String(PORT), VIDEOS_PATH: videosDir,
    DB_HOST: '127.0.0.1', DB_PORT: '1', MIGRATIONS_RETRY_ATTEMPTS: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => { log += d; });
server.stderr.on('data', (d) => { log += d; });

const status = (p, token) =>
  fetch(`http://127.0.0.1:${PORT}${p}`, { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.status)
    .catch(() => 0);

(async () => {
  const checks = [];
  const check = (name, pass, extra = '') => checks.push([name, pass, extra]);

  // ── Unidades puras (no necesitan servidor) ──────────────────────────────
  check('id numérico válido', parseNumericId('42') === 42);
  check('id no numérico rechazado', parseNumericId('abc') === null);
  check('id negativo rechazado', parseNumericId('-1') === null);
  check('id fuera de int4 rechazado', parseNumericId('99999999999') === null);
  check('rango con basura -> archivo completo', parseRangeHeader('bytes=abc', 1000) === null);
  check('rango fuera del archivo -> 416', parseRangeHeader('bytes=5000-', 1000) === 'unsatisfiable');

  let up = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) { up = true; break; } } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!up) {
    console.error('❌ el servidor no arrancó');
    console.error(log.slice(-1500));
    server.kill();
    process.exit(1);
  }

  const imagePath = '/api/images/' + encodeURI(posterPath);

  // ── Alcance del token de media ──────────────────────────────────────────
  check('media token sirve para una imagen', await status(imagePath, mediaToken) === 200);
  check('access token también sirve', await status(imagePath, accessToken) === 200);
  check('media token NO llega a /api/users', await status('/api/users', mediaToken) === 403);
  check('media token NO llega a /api/libraries', await status('/api/libraries', mediaToken) === 403);
  check('media token NO llega a /api/dashboard', await status('/api/dashboard', mediaToken) === 403);
  check('media token NO puede pedir otro media token',
    await status('/api/auth/media-token', mediaToken) === 403);
  check('access token sí puede pedir media token',
    await status('/api/auth/media-token', accessToken) === 200);

  // El endpoint emite un token realmente acotado
  const issued = await fetch(`http://127.0.0.1:${PORT}/api/auth/media-token`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).then((r) => r.json());
  const decoded = jwt.decode(issued.token || '');
  check('el token emitido es de tipo media', decoded?.type === 'media', JSON.stringify(decoded));
  check('el token emitido no lleva is_admin', decoded?.is_admin === undefined);
  check('el token emitido no lleva email', decoded?.email === undefined);
  check('el token emitido caduca en horas, no días',
    decoded && (decoded.exp - decoded.iat) <= 24 * 3600, `${decoded && (decoded.exp - decoded.iat)}s`);

  // ── Validación de ids de ruta ───────────────────────────────────────────
  check('/api/videos/abc -> 400 (antes 500)', await status('/api/videos/abc', accessToken) === 400);
  check('/api/comics/xyz -> 400', await status('/api/comics/xyz', accessToken) === 400);
  check('/api/videos/1.5 -> 400', await status('/api/videos/1.5', accessToken) === 400);
  check('/api/music/playlists/abc -> 400', await status('/api/music/playlists/abc', accessToken) === 400);
  check('un id válido no se rechaza (llega al handler)',
    [404, 500].includes(await status('/api/videos/999999', accessToken)));

  let ok = true;
  for (const [name, pass, extra] of checks) {
    console.log(`${pass ? '✅' : '❌'} ${name}${pass || !extra ? '' : ' — ' + extra}`);
    if (!pass) ok = false;
  }
  if (!ok) console.error('\n--- log ---\n' + log.slice(-2000));

  server.kill();
  fs.rmSync(videosDir, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
})();

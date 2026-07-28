// Ejercita los endpoints de caché HLS (ahora async) contra el backend real.
// No necesita DB: authenticateToken/requireAdmin sólo miran el JWT.
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const SECRET = 'test-secret-hls-cache';
const PORT = 5601;
const CACHE = path.resolve('/tmp/ubeflix-hls'); // el que usa el código

// Sesión falsa, con la forma que espera collectCacheSessionEntries: <videoId>/a<track>/
const sessionDir = path.join(CACHE, '999999', 'a0');
const renditionDir = path.join(sessionDir, '480p');
fs.mkdirSync(renditionDir, { recursive: true });
fs.writeFileSync(path.join(sessionDir, 'index.m3u8'), '#EXTM3U\n');
for (let i = 0; i < 50; i++) {
  fs.writeFileSync(path.join(renditionDir, `seg_${String(i).padStart(5, '0')}.ts`), 'x'.repeat(1024));
}
const expectedBytes = 50 * 1024 + '#EXTM3U\n'.length;
// Antigua a propósito, para que el barrido por TTL la desaloje.
const old = new Date(Date.now() - 10 * 60 * 60 * 1000);
fs.utimesSync(sessionDir, old, old);

const token = jwt.sign({ id: 1, username: 'admin', is_admin: true }, SECRET, { expiresIn: '1h' });
const auth = { Authorization: `Bearer ${token}` };

const server = spawn(process.execPath, ['src/index.js'], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, JWT_SECRET: SECRET, PORT: String(PORT), DB_HOST: '127.0.0.1', DB_PORT: '1', MIGRATIONS_RETRY_ATTEMPTS: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => { log += d; });
server.stderr.on('data', (d) => { log += d; });

const api = (p, opts = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, { headers: auth, ...opts });

(async () => {
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

  const checks = [];
  const check = (name, pass, extra = '') => checks.push([name, pass, extra]);

  // stats: recorre el caché con la versión async
  const statsRes = await api('/api/videos/hls-cache/stats');
  const stats = await statsRes.json();
  check('stats responde 200', statsRes.status === 200, `status ${statsRes.status}`);
  check('encuentra la sesión en disco',
    stats.sessions?.some((s) => s.videoId === '999999'), JSON.stringify(stats.sessions?.slice(0, 2)));
  const found = stats.sessions?.find((s) => s.videoId === '999999');
  check('mide el tamaño correctamente',
    found?.sizeBytes === expectedBytes, `${found?.sizeBytes} vs ${expectedBytes} esperados`);
  check('el total agrega los tamaños', stats.totals?.bytes >= expectedBytes, `${stats.totals?.bytes}`);

  // cleanup: la sesión es vieja → debe desalojarse por TTL
  const cleanupRes = await api('/api/videos/hls-cache/cleanup', { method: 'POST' });
  const cleanup = await cleanupRes.json();
  check('cleanup responde 200', cleanupRes.status === 200, `status ${cleanupRes.status}`);
  check('reporta bytes liberados', cleanup.removed?.bytes >= expectedBytes, JSON.stringify(cleanup.removed));
  check('la sesión vencida se borró del disco', !fs.existsSync(sessionDir));
  check('registra el desalojo con motivo ttl',
    cleanup.recentEvictions?.some((e) => e.dir?.includes('999999') && e.reason?.startsWith('ttl')),
    JSON.stringify(cleanup.recentEvictions?.slice(0, 2)));

  // invalidar una sesión inexistente → 404 (recorre la rama de disco)
  const gone = await api('/api/videos/hls-cache/session/999999/0', { method: 'DELETE' });
  check('invalidar una sesión ya borrada -> 404', gone.status === 404, `status ${gone.status}`);

  let ok = true;
  for (const [name, pass, extra] of checks) {
    console.log(`${pass ? '✅' : '❌'} ${name}${pass || !extra ? '' : ' — ' + extra}`);
    if (!pass) ok = false;
  }
  if (!ok) console.error('\n--- log ---\n' + log.slice(-2500));

  server.kill();
  fs.rmSync(path.join(CACHE, '999999'), { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
})();

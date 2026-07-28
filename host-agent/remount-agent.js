// ubeFlix — Agente de remontaje (corre en el HOST Windows, no en Docker)
// ---------------------------------------------------------------------------
// Escucha en 127.0.0.1 y, ante un POST /remount { drive: "H" }, re-monta la
// unidad de Windows dentro de la VM WSL2 "docker-desktop" y reinicia el
// contenedor del backend para que la vea. Equivale a remount-host-drive.ps1
// pero disparado con un botón desde la app.
//
// Seguridad: sólo escucha en loopback (127.0.0.1), así que únicamente procesos
// de esta misma máquina pueden llamarlo. Además exige el token compartido
// REMOUNT_AGENT_TOKEN (definido en .env), que el backend sólo entrega a
// usuarios autenticados.
//
// Uso:   node host-agent/remount-agent.js
//        (o doble clic en host-agent/start-agent.cmd)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

// --- Config ----------------------------------------------------------------
const HOST = '127.0.0.1';
const PORT = parseInt(process.env.REMOUNT_AGENT_PORT || '9797', 10);
const BACKEND_CONTAINER = process.env.REMOUNT_BACKEND_CONTAINER || 'ubeflix-backend';
const BACKEND_HEALTH_URL = process.env.REMOUNT_BACKEND_HEALTH || 'http://localhost:5566/api/health';
const WSL_DISTRO = process.env.REMOUNT_WSL_DISTRO || 'docker-desktop';
const HEALTH_TIMEOUT_MS = 45000;

// Lee REMOUNT_AGENT_TOKEN del entorno o del .env del proyecto (un nivel arriba).
function loadToken() {
  if (process.env.REMOUNT_AGENT_TOKEN) return process.env.REMOUNT_AGENT_TOKEN.trim();
  try {
    const envPath = path.join(__dirname, '..', '.env');
    const txt = fs.readFileSync(envPath, 'utf8');
    const m = txt.match(/^\s*REMOUNT_AGENT_TOKEN\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* ignore */ }
  return '';
}
const TOKEN = loadToken();

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// --- Helpers ---------------------------------------------------------------

// Re-monta la unidad en la VM docker-desktop. Devuelve true si quedó legible.
function remountInVm(letter) {
  const l = letter.toLowerCase();
  const L = letter.toUpperCase();
  const script =
    `umount -l /mnt/host/${l} 2>/dev/null; ` +
    `mkdir -p /mnt/host/${l}; ` +
    `mount -t drvfs '${L}:' /mnt/host/${l} 2>&1; ` +
    `ls /mnt/host/${l} >/dev/null 2>&1 && echo OK || echo FAIL`;
  const res = spawnSync('wsl', ['-d', WSL_DISTRO, '-e', 'sh', '-c', script], {
    encoding: 'utf8',
    timeout: 30000,
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  log(`[remount ${L}:] wsl ->`, out.trim().replace(/\s+/g, ' '));
  return /(^|\n)OK\s*$/.test(out) || /\bOK\b/.test(out.trim().split('\n').pop());
}

function restartBackend() {
  const res = spawnSync('docker', ['restart', BACKEND_CONTAINER], {
    encoding: 'utf8',
    timeout: 60000,
  });
  log('[restart backend] docker ->', `${res.stdout || ''}${res.stderr || ''}`.trim());
  return res.status === 0;
}

// Espera a que el backend responda 200 en /api/health.
function waitForBackend() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  return new Promise((resolve) => {
    const tick = () => {
      const req = http.get(BACKEND_HEALTH_URL, (r) => {
        r.resume();
        if (r.statusCode === 200) return resolve(true);
        retry();
      });
      req.on('error', retry);
      req.setTimeout(3000, () => req.destroy());
    };
    const retry = () => {
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(tick, 1500);
    };
    tick();
  });
}

function sendJson(res, status, body, origin) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

// --- Server ----------------------------------------------------------------
const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  // Preflight CORS (el navegador lo manda por el header X-Remount-Token).
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Remount-Token',
      'Access-Control-Max-Age': '600',
      'Vary': 'Origin',
    });
    return res.end();
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: 'ubeflix-remount-agent' }, origin);
  }

  if (req.method === 'POST' && url.pathname === '/remount') {
    // Token
    if (TOKEN && req.headers['x-remount-token'] !== TOKEN) {
      log('[remount] token inválido');
      return sendJson(res, 401, { ok: false, error: 'Token inválido' }, origin);
    }

    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e4) req.destroy(); });
    req.on('end', async () => {
      let drive = url.searchParams.get('drive');
      if (!drive && raw) {
        try { drive = JSON.parse(raw).drive; } catch { /* ignore */ }
      }
      const letter = String(drive || '').trim().replace(/[:\\/]/g, '');
      if (!/^[a-zA-Z]$/.test(letter)) {
        return sendJson(res, 400, { ok: false, error: 'Letra de unidad inválida' }, origin);
      }

      log(`[remount] solicitando reconexión de ${letter.toUpperCase()}:`);
      if (!remountInVm(letter)) {
        return sendJson(res, 502, {
          ok: false,
          error: `No se pudo montar ${letter.toUpperCase()}:. ¿Está la unidad conectada en Windows?`,
        }, origin);
      }

      restartBackend();
      const healthy = await waitForBackend();
      log(`[remount] ${letter.toUpperCase()}: reconectada. backend healthy=${healthy}`);
      return sendJson(res, 200, {
        ok: true,
        drive: letter.toUpperCase(),
        backendHealthy: healthy,
      }, origin);
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: 'No encontrado' }, origin);
});

server.listen(PORT, HOST, () => {
  log(`ubeFlix remount-agent escuchando en http://${HOST}:${PORT}`);
  log(`  distro WSL: ${WSL_DISTRO} · contenedor: ${BACKEND_CONTAINER}`);
  log(`  token: ${TOKEN ? 'configurado' : 'DESACTIVADO (sin REMOUNT_AGENT_TOKEN)'}`);
});

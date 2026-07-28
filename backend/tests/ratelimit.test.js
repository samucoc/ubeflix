// Verifica que el rate limit del login sea por (IP + cuenta) y no global.
process.env.JWT_SECRET = 'test-secret-only-for-this-check';
process.env.TRUST_PROXY = 'loopback'; // el test conecta desde 127.0.0.1

const express = require('express');
const authRoutes = require('../src/routes/auth');

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY);
app.use(express.json());
app.use('/api/auth', authRoutes);

const server = app.listen(0, async () => {
  const port = server.address().port;
  const post = (username, ip) =>
    fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: JSON.stringify({ username, password: 'wrong-password' }),
    }).then((r) => r.status);

  const results = [];
  // 12 intentos fallidos contra "victima" desde la IP del atacante
  let last = 0;
  for (let i = 0; i < 12; i++) last = await post('victima', '203.0.113.5');
  results.push(['atacante tras 12 intentos -> 429', last === 429]);

  // La victima, desde SU propia IP, debe poder seguir intentando
  const victimaOwnIp = await post('victima', '198.51.100.20');
  results.push(['victima desde su IP no bloqueada', victimaOwnIp !== 429]);

  // Otro usuario desde la MISMA IP del atacante: limite por cuenta independiente
  const otherAccount = await post('otro-usuario', '203.0.113.5');
  results.push(['otra cuenta misma IP no bloqueada', otherAccount !== 429]);

  // Techo por IP: barrer muchas cuentas desde una IP termina cortado
  let sweep = 0;
  for (let i = 0; i < 60; i++) sweep = await post(`cuenta${i}`, '203.0.113.99');
  results.push(['barrido de 60 cuentas desde 1 IP -> 429', sweep === 429]);

  let ok = true;
  for (const [name, pass] of results) {
    console.log(`${pass ? '✅' : '❌'} ${name}`);
    if (!pass) ok = false;
  }
  server.close();
  process.exit(ok ? 0 : 1);
});

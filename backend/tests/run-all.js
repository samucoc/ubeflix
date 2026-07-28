// Corre todas las suites y resume. Uso: npm test
//
// Las suites que necesitan base de datos se saltan solas si no hay una
// accesible, así que `npm test` sirve igual sin levantar Docker.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SUITES = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

function run(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, file)], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });

    child.on('close', (code) => {
      const lines = out.split('\n').filter((l) => /^(✅|❌)/.test(l.trim()));
      resolve({ file, code, lines, raw: out });
    });
  });
}

(async () => {
  let failed = 0;
  let passed = 0;

  for (const suite of SUITES) {
    console.log(`\n── ${suite} ${'─'.repeat(Math.max(0, 50 - suite.length))}`);
    const result = await run(suite);
    for (const line of result.lines) {
      console.log(line);
      if (line.trim().startsWith('❌')) failed++;
      else passed++;
    }
    if (result.lines.length === 0) {
      console.log('   (sin resultados — revisá la salida)');
      console.log(result.raw.split('\n').slice(-15).join('\n'));
      failed++;
    }
  }

  console.log(`\n${'═'.repeat(56)}`);
  console.log(`${failed === 0 ? '✅' : '❌'}  ${passed} pasaron, ${failed} fallaron`);
  process.exit(failed === 0 ? 0 : 1);
})();

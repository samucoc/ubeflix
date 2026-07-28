const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../config/db');

// Passwords that shipped in the repo (init.sql) or in the helper scripts. Any
// account still using one is effectively public, so we shout about it on boot.
const KNOWN_WEAK_PASSWORDS = ['admin123', '123456', 'admin', 'password', 'ubeflix'];

// Creates the first admin when the database has no users at all.
// The password comes from ADMIN_PASSWORD; if unset we generate a random one and
// print it once, so a fresh install is never reachable with a published default.
async function createFirstAdmin() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM users');
  if (rows[0].count > 0) return false;

  const username = process.env.ADMIN_USERNAME || 'admin';
  const email = process.env.ADMIN_EMAIL || 'admin@ubeflix.local';
  const fromEnv = !!process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(18).toString('base64url');

  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO users (username, email, password_hash, is_admin)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (username) DO NOTHING`,
    [username, email, hash]
  );

  console.log('\n┌─────────────────────────────────────────────────────────────');
  console.log(`│ 👤 Usuario administrador creado: ${username}`);
  if (fromEnv) {
    console.log('│    Contraseña: la definida en ADMIN_PASSWORD');
  } else {
    console.log(`│    Contraseña generada: ${password}`);
    console.log('│    ⚠️  Guardala ahora: no se vuelve a mostrar.');
  }
  console.log('└─────────────────────────────────────────────────────────────\n');
  return true;
}

// Flags existing accounts that still use one of the published defaults.
async function warnAboutWeakPasswords() {
  const { rows } = await pool.query(
    'SELECT username, password_hash FROM users WHERE is_admin = TRUE'
  );

  const weak = [];
  for (const user of rows) {
    for (const candidate of KNOWN_WEAK_PASSWORDS) {
      if (await bcrypt.compare(candidate, user.password_hash)) {
        weak.push({ username: user.username, password: candidate });
        break;
      }
    }
  }

  if (weak.length > 0) {
    console.warn('\n┌─────────────────────────────────────────────────────────────');
    console.warn('│ 🚨 CUENTAS DE ADMIN CON CONTRASEÑA CONOCIDA PÚBLICAMENTE');
    for (const { username, password } of weak) {
      console.warn(`│    - ${username} (usa "${password}")`);
    }
    console.warn('│    Cambiala ya desde Ajustes → Usuarios.');
    console.warn('└─────────────────────────────────────────────────────────────\n');
  }
  return weak.length;
}

async function bootstrapAdmin() {
  try {
    const created = await createFirstAdmin();
    if (!created) await warnAboutWeakPasswords();
  } catch (err) {
    console.error('Bootstrap admin error:', err.message);
  }
}

module.exports = { bootstrapAdmin, createFirstAdmin, warnAboutWeakPasswords, KNOWN_WEAK_PASSWORDS };

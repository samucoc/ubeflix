#!/usr/bin/env node
// Cambia la contraseña de un usuario. Reemplaza a create-user.js, que traía la
// contraseña ("123456") y las credenciales de la base escritas en el código.
//
//   node scripts/set-password.js <usuario-o-email> '<contraseña-nueva>'
//
// Sin contraseña genera una aleatoria y la imprime una sola vez.
// La conexión sale de las variables de entorno (.env), nunca del código.
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../src/config/db');

const MIN_LENGTH = 8;

async function main() {
  const identifier = process.argv[2];
  let password = process.argv[3];

  if (!identifier) {
    console.error('Uso: node scripts/set-password.js <usuario-o-email> [contraseña]');
    process.exit(1);
  }

  const generated = !password;
  if (generated) password = crypto.randomBytes(18).toString('base64url');

  if (password.length < MIN_LENGTH) {
    console.error(`La contraseña debe tener al menos ${MIN_LENGTH} caracteres.`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
     WHERE username = $2 OR email = $2
     RETURNING id, username, email, is_admin`,
    [hash, identifier]
  );

  if (rows.length === 0) {
    console.error(`No existe ningún usuario con username o email "${identifier}".`);
    process.exit(1);
  }

  const user = rows[0];
  console.log(`✅ Contraseña actualizada para ${user.username} (${user.email})${user.is_admin ? ' [admin]' : ''}`);
  if (generated) {
    console.log(`   Contraseña generada: ${password}`);
    console.log('   Guardala ahora: no se vuelve a mostrar.');
  }
}

main()
  .catch((err) => { console.error('Error:', err.message); process.exitCode = 1; })
  .finally(() => pool.end());

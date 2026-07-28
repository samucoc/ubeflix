/**
 * Utility script to generate bcrypt hashes for the database.
 * Run: node scripts/generate-hash.js <password>
 */
const bcrypt = require('bcryptjs');

const password = process.argv[2];
if (!password) {
  console.error('Uso: node scripts/generate-hash.js <password>');
  process.exit(1);
}
const hash = bcrypt.hashSync(password, 10);

console.log(`Password: ${password}`);
console.log(`Hash: ${hash}`);
console.log(`\nSQL:\nUPDATE users SET password_hash = '${hash}' WHERE username = 'admin';`);

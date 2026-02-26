const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'ubeflix',
  user: process.env.DB_USER || 'ubeflix_user',
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 10000,
  allowExitOnIdle: false,
});

pool.on('error', (err) => {
  console.error('Pool idle client error (non-fatal):', err.message);
});

module.exports = { pool };

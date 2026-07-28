const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

const VERSIONS_DIR = path.join(__dirname, 'versions');

// init.sql only ever runs when Docker creates the Postgres volume, so schema
// changes never reached an existing install. That's why routes grew their own
// ensureSchema() helpers running DDL on every request. Instead, versioned files
// in migrations/versions/ are applied once, in order, at startup, and recorded
// in schema_migrations so routes can assume the schema exists.
//
// Every migration still uses IF NOT EXISTS: a database created from init.sql
// already has part of this, and re-running must be harmless.

// Postgres may still be accepting connections a moment after the healthcheck
// passes; a few retries beat silently starting with an unmigrated schema.
async function ensureMigrationsTable({
  attempts = parseInt(process.env.MIGRATIONS_RETRY_ATTEMPTS || '5', 10),
  delayMs = parseInt(process.env.MIGRATIONS_RETRY_DELAY_MS || '2000', 10),
} = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version     VARCHAR(255) PRIMARY KEY,
          applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      return;
    } catch (err) {
      if (attempt >= attempts) throw err;
      console.warn(`Esperando a la base de datos (intento ${attempt}/${attempts}): ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

function listMigrations() {
  let files;
  try {
    files = fs.readdirSync(VERSIONS_DIR);
  } catch {
    return [];
  }
  return files
    .filter((f) => f.endsWith('.sql'))
    .sort() // zero-padded numeric prefixes keep this in order
    .map((file) => ({ version: file.replace(/\.sql$/, ''), file: path.join(VERSIONS_DIR, file) }));
}

async function appliedVersions() {
  const { rows } = await pool.query('SELECT version FROM schema_migrations');
  return new Set(rows.map((r) => r.version));
}

// Each migration runs in its own transaction: a failure rolls back that file
// only and leaves it unrecorded, so the next boot retries it.
async function applyMigration({ version, file }) {
  const sql = fs.readFileSync(file, 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    await client.query('COMMIT');
    console.log(`🔧 Migración aplicada: ${version}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function runMigrations() {
  await ensureMigrationsTable();

  const migrations = listMigrations();
  const applied = await appliedVersions();
  const pending = migrations.filter((m) => !applied.has(m.version));

  if (pending.length === 0) {
    console.log(`📦 Schema al día (${applied.size} migración(es) aplicadas)`);
    return { applied: 0, failed: 0 };
  }

  let ok = 0;
  let failed = 0;
  for (const migration of pending) {
    try {
      await applyMigration(migration);
      ok++;
    } catch (err) {
      failed++;
      console.error(`❌ Migración ${migration.version} falló:`, err.message);
    }
  }
  return { applied: ok, failed };
}

module.exports = { runMigrations };

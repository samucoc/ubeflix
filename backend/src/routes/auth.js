const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { generateToken, generateMediaToken, MEDIA_TOKEN_TTL } = require('../middleware/auth');

const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

// Simple in-memory rate limiter for auth endpoints.
// Requires `trust proxy` to be set in index.js — otherwise req.ip is the
// reverse proxy's address and every user shares a single bucket.
const loginAttempts = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
// Per (IP + account): stops brute force against one account.
const MAX_ATTEMPTS_PER_ACCOUNT = 10;
// Per IP across all accounts: stops sweeping many accounts from one source.
// Deliberately higher so a shared IP (household NAT) isn't locked out by one user.
const MAX_ATTEMPTS_PER_IP = 50;
// Safety valve so a flood of distinct keys can't grow the map without bound.
const MAX_TRACKED_KEYS = 10000;

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function bump(key, now) {
  const record = loginAttempts.get(key);
  if (!record || now - record.firstAttempt > RATE_LIMIT_WINDOW) {
    loginAttempts.set(key, { count: 1, firstAttempt: now });
    return { count: 1, firstAttempt: now };
  }
  record.count++;
  return record;
}

function retryAfterSeconds(record, now) {
  return Math.max(1, Math.ceil((RATE_LIMIT_WINDOW - (now - record.firstAttempt)) / 1000));
}

function rateLimit(req, res, next) {
  const now = Date.now();
  const ip = clientIp(req);
  const account = String(req.body?.username || '').trim().toLowerCase().slice(0, 100);

  if (loginAttempts.size > MAX_TRACKED_KEYS) cleanupExpired(now);

  const ipRecord = bump(`ip:${ip}`, now);
  const accountRecord = bump(`acct:${ip}|${account}`, now);

  const limited =
    (accountRecord.count > MAX_ATTEMPTS_PER_ACCOUNT && accountRecord) ||
    (ipRecord.count > MAX_ATTEMPTS_PER_IP && ipRecord);

  if (limited) {
    const retryAfter = retryAfterSeconds(limited, now);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: `Demasiados intentos. Reintenta en ${retryAfter}s` });
  }

  // Let the handler clear the counters when the credentials turn out to be valid.
  req.clearRateLimit = () => {
    loginAttempts.delete(`ip:${ip}`);
    loginAttempts.delete(`acct:${ip}|${account}`);
  };

  next();
}

function cleanupExpired(now = Date.now()) {
  for (const [key, record] of loginAttempts) {
    if (now - record.firstAttempt > RATE_LIMIT_WINDOW) loginAttempts.delete(key);
  }
}

// Cleanup old rate limit entries every 30 minutes
setInterval(() => cleanupExpired(), 30 * 60 * 1000).unref();

// Input sanitizer
function sanitizeString(str, maxLen = 255) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen);
}

// POST /api/auth/register
router.post('/register', rateLimit, asyncHandler(async (req, res) => {
  const username = sanitizeString(req.body.username, 50);
  const email = sanitizeString(req.body.email, 100);
  const password = req.body.password;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Todos los campos son requeridos' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }

  // Check if user exists
  const existing = await pool.query(
    'SELECT id FROM users WHERE username = $1 OR email = $2',
    [username, email]
  );

  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'El usuario o email ya existe' });
  }

  const password_hash = await bcrypt.hash(password, 10);

  const result = await pool.query(
    'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, is_admin, created_at',
    [username, email, password_hash]
  );

  const user = result.rows[0];
  const token = generateToken(user);

  res.status(201).json({ user, token });
}));

// POST /api/auth/login
router.post('/login', rateLimit, asyncHandler(async (req, res) => {
  const username = sanitizeString(req.body.username, 50);
  const password = req.body.password;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  }

  const result = await pool.query(
    'SELECT id, username, email, password_hash, is_admin FROM users WHERE username = $1 OR email = $1',
    [username]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const user = result.rows[0];
  const validPassword = await bcrypt.compare(password, user.password_hash);

  if (!validPassword) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  // Valid credentials — don't hold failed attempts against this client.
  req.clearRateLimit?.();

  const token = generateToken(user);
  delete user.password_hash;

  res.json({ user, token });
}));

// GET /api/auth/media-token — Token corto y de solo-media para URLs de <video>,
// <img> y segmentos HLS, que no pueden mandar cabecera Authorization.
router.get('/media-token', asyncHandler(async (req, res) => {
  if (req.tokenType === 'media') {
    // Un token de media no puede renovarse a sí mismo indefinidamente.
    return res.status(403).json({ error: 'Se requiere una sesión activa' });
  }
  res.json({
    token: generateMediaToken(req.user),
    expiresIn: MEDIA_TOKEN_TTL,
  });
}));

// GET /api/auth/me
router.get('/me', async (req, res) => {
  // This route is protected by middleware in index.js
  try {
    const result = await pool.query(
      'SELECT id, username, email, is_admin, avatar_url, created_at FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;

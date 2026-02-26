const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { generateToken } = require('../middleware/auth');

const router = express.Router();

// Simple in-memory rate limiter for auth endpoints
const loginAttempts = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 10;

function rateLimit(req, res, next) {
  const key = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const record = loginAttempts.get(key);

  if (record) {
    // Clean expired entries
    if (now - record.firstAttempt > RATE_LIMIT_WINDOW) {
      loginAttempts.set(key, { count: 1, firstAttempt: now });
      return next();
    }
    if (record.count >= MAX_ATTEMPTS) {
      const retryAfter = Math.ceil((RATE_LIMIT_WINDOW - (now - record.firstAttempt)) / 1000);
      return res.status(429).json({ error: `Demasiados intentos. Reintenta en ${retryAfter}s` });
    }
    record.count++;
  } else {
    loginAttempts.set(key, { count: 1, firstAttempt: now });
  }
  next();
}

// Cleanup old rate limit entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of loginAttempts) {
    if (now - record.firstAttempt > RATE_LIMIT_WINDOW) loginAttempts.delete(key);
  }
}, 30 * 60 * 1000);

// Input sanitizer
function sanitizeString(str, maxLen = 255) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen);
}

// POST /api/auth/register
router.post('/register', rateLimit, async (req, res) => {
  try {
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
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/auth/login
router.post('/login', rateLimit, async (req, res) => {
  try {
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

    const token = generateToken(user);
    delete user.password_hash;

    res.json({ user, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

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

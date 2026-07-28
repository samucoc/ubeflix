const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { requireAdmin } = require('../middleware/auth');

const { asyncHandler } = require('../utils/asyncHandler');

const { requireNumericParams } = require('../utils/params');

const router = express.Router();

// Los ids de ruta van directo a la base: validarlos acá evita un 500 por `/api/x/abc`.
requireNumericParams(router, 'id');

// GET /api/users — List all users (admin only)
router.get('/', requireAdmin, asyncHandler(async (req, res) => {
  const result = await pool.query(
    'SELECT id, username, email, is_admin, avatar_url, created_at, updated_at FROM users ORDER BY created_at DESC'
  );
  res.json(result.rows);
}));

// PUT /api/users/:id — Update user (admin only)
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, is_admin, password } = req.body;

    // Prevent admin from removing their own admin role
    if (parseInt(id) === req.user.id && is_admin === false) {
      return res.status(400).json({ error: 'No puedes quitarte los permisos de administrador a ti mismo' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    let query = 'UPDATE users SET updated_at = CURRENT_TIMESTAMP';
    const params = [];
    let paramIndex = 1;

    if (username !== undefined) {
      query += `, username = $${paramIndex++}`;
      params.push(username);
    }

    if (email !== undefined) {
      query += `, email = $${paramIndex++}`;
      params.push(email);
    }

    if (is_admin !== undefined) {
      query += `, is_admin = $${paramIndex++}`;
      params.push(is_admin);
    }

    if (password) {
      const hash = await bcrypt.hash(password, 10);
      query += `, password_hash = $${paramIndex++}`;
      params.push(hash);
    }

    query += ` WHERE id = $${paramIndex++} RETURNING id, username, email, is_admin, avatar_url, created_at, updated_at`;
    params.push(id);

    const result = await pool.query(query, params);
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'El nombre de usuario o email ya está en uso' });
    }
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/users/:id — Delete user (admin only)
router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Prevent admin from deleting themselves
  if (parseInt(id) === req.user.id) {
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
  }

  const existing = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }

  await pool.query('DELETE FROM users WHERE id = $1', [id]);
  res.json({ message: 'Usuario eliminado' });
}));

module.exports = router;

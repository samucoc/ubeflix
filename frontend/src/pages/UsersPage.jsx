import React, { useState, useEffect } from 'react';
import { getUsers, updateUser, deleteUser } from '../api';
import { Users, Shield, ShieldOff, Trash2, Edit3, X, Save } from 'lucide-react';
import Swal from 'sweetalert2';

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [error, setError] = useState('');

  const loadUsers = () => {
    getUsers()
      .then((res) => setUsers(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleToggleAdmin = async (user) => {
    try {
      setError('');
      await updateUser(user.id, { is_admin: !user.is_admin });
      loadUsers();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al actualizar usuario');
    }
  };

  const handleDelete = async (user) => {
    const result = await Swal.fire({
      title: '¿Eliminar usuario?',
      text: `Se eliminará al usuario "${user.username}".`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#ef4444',
    });
    if (!result.isConfirmed) return;
    try {
      setError('');
      await deleteUser(user.id);
      loadUsers();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al eliminar usuario');
    }
  };

  const handleEdit = (user) => {
    setEditingUser(user.id);
    setEditForm({ username: user.username, email: user.email, password: '' });
    setError('');
  };

  const handleSaveEdit = async () => {
    try {
      setError('');
      const data = { username: editForm.username, email: editForm.email };
      if (editForm.password) data.password = editForm.password;
      await updateUser(editingUser, data);
      setEditingUser(null);
      loadUsers();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al actualizar usuario');
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner" /></div>;
  }

  return (
    <div>
      <h1 className="page-title">
        Gestión de Usuarios
        <span className="page-subtitle"> — {users.length} usuarios registrados</span>
      </h1>

      {error && (
        <div className="login-error" style={{ marginBottom: 16 }}>{error}</div>
      )}

      {/* Edit modal */}
      {editingUser && (
        <div className="modal-overlay" onClick={() => setEditingUser(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Editar Usuario</h3>
            <div className="form-group">
              <label className="form-label">Nombre de usuario</label>
              <input
                className="form-input"
                value={editForm.username}
                onChange={(e) => setEditForm({ ...editForm, username: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                className="form-input"
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Nueva contraseña (dejar vacío para no cambiar)</label>
              <input
                className="form-input"
                type="password"
                value={editForm.password}
                onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                placeholder="••••••"
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setEditingUser(null)}>
                <X size={16} /> Cancelar
              </button>
              <button className="btn btn-primary" onClick={handleSaveEdit}>
                <Save size={16} /> Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Email</th>
              <th>Rol</th>
              <th>Registrado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="sidebar-user-avatar" style={{ width: 32, height: 32, fontSize: 12 }}>
                      {user.username.charAt(0).toUpperCase()}
                    </div>
                    {user.username}
                  </div>
                </td>
                <td>{user.email}</td>
                <td>
                  <span className={`badge ${user.is_admin ? 'badge-admin' : 'badge-user'}`}>
                    {user.is_admin ? 'Admin' : 'Usuario'}
                  </span>
                </td>
                <td>{new Date(user.created_at).toLocaleDateString()}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => handleEdit(user)}
                      title="Editar"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => handleToggleAdmin(user)}
                      title={user.is_admin ? 'Quitar admin' : 'Hacer admin'}
                    >
                      {user.is_admin ? <ShieldOff size={14} /> : <Shield size={14} />}
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => handleDelete(user)}
                      title="Eliminar"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import React from 'react';
import { useAuth } from '../context/AuthContext';
import { Settings, Info, Server, Database } from 'lucide-react';

export default function SettingsPage() {
  const { user } = useAuth();

  return (
    <div>
      <h1 className="page-title">Configuración</h1>

      <div className="settings-grid">
        {/* About section */}
        <div className="settings-card">
          <div className="settings-card-header">
            <Info size={20} />
            <h3>Acerca de ubeFlix</h3>
          </div>
          <div className="settings-card-body">
            <div className="settings-row">
              <span className="settings-label">Versión</span>
              <span className="settings-value">1.0.0</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Plataforma</span>
              <span className="settings-value">Docker</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Frontend</span>
              <span className="settings-value">React + Vite</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Backend</span>
              <span className="settings-value">Node.js + Express</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Base de datos</span>
              <span className="settings-value">PostgreSQL 16</span>
            </div>
          </div>
        </div>

        {/* Account section */}
        <div className="settings-card">
          <div className="settings-card-header">
            <Settings size={20} />
            <h3>Mi Cuenta</h3>
          </div>
          <div className="settings-card-body">
            <div className="settings-row">
              <span className="settings-label">Usuario</span>
              <span className="settings-value">{user?.username}</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Email</span>
              <span className="settings-value">{user?.email}</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Rol</span>
              <span className="settings-value">
                <span className={`badge ${user?.is_admin ? 'badge-admin' : 'badge-user'}`}>
                  {user?.is_admin ? 'Administrador' : 'Usuario'}
                </span>
              </span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Miembro desde</span>
              <span className="settings-value">{user?.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}</span>
            </div>
          </div>
        </div>

        {/* Server info (admin only) */}
        {user?.is_admin && (
          <div className="settings-card">
            <div className="settings-card-header">
              <Server size={20} />
              <h3>Servidor</h3>
            </div>
            <div className="settings-card-body">
              <div className="settings-row">
                <span className="settings-label">Estado</span>
                <span className="settings-value" style={{ color: 'var(--success)' }}>En línea</span>
              </div>
              <div className="settings-row">
                <span className="settings-label">API URL</span>
                <span className="settings-value">/api</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Play } from 'lucide-react';

export default function LoginPage() {
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isRegister) {
        await register(username, email, password);
      } else {
        await login(username, password);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div style={{
            width: 56, height: 56, margin: '0 auto 12px',
            background: 'linear-gradient(135deg, #00a4dc, #aa5cc3)',
            borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Play size={28} color="white" />
          </div>
          <h1>ubeFlix</h1>
          <p>{isRegister ? 'Crear una cuenta' : 'Inicia sesión en tu servidor'}</p>
        </div>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Usuario</label>
            <input
              type="text"
              className="form-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Tu nombre de usuario"
              required
              autoFocus
            />
          </div>

          {isRegister && (
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                type="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                required
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Contraseña</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
            disabled={loading}
          >
            {loading ? 'Cargando...' : isRegister ? 'Crear cuenta' : 'Iniciar sesión'}
          </button>
        </form>

        <div className="login-footer">
          {isRegister ? (
            <>¿Ya tienes cuenta? <a onClick={() => { setIsRegister(false); setError(''); }}>Inicia sesión</a></>
          ) : (
            <>¿No tienes cuenta? <a onClick={() => { setIsRegister(true); setError(''); }}>Regístrate</a></>
          )}
        </div>
      </div>
    </div>
  );
}

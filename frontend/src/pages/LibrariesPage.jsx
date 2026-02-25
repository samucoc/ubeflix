import React, { useState, useEffect } from 'react';
import { getLibraries, createLibrary, deleteLibrary, scanLibrary } from '../api';
import { FolderOpen, Plus, Trash2, RefreshCw, X } from 'lucide-react';

export default function LibrariesPage() {
  const [libraries, setLibraries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [scanning, setScanning] = useState({});
  const [form, setForm] = useState({ name: '', path: '', library_type: 'movies' });
  const [error, setError] = useState('');

  const loadLibraries = () => {
    getLibraries()
      .then((res) => setLibraries(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadLibraries(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await createLibrary(form);
      setShowModal(false);
      setForm({ name: '', path: '', library_type: 'movies' });
      loadLibraries();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al crear biblioteca');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar esta biblioteca y todo su contenido escaneado?')) return;
    try {
      await deleteLibrary(id);
      loadLibraries();
    } catch (err) {
      console.error(err);
    }
  };

  const handleScan = async (id) => {
    setScanning((prev) => ({ ...prev, [id]: true }));
    try {
      await scanLibrary(id);
      setTimeout(() => {
        setScanning((prev) => ({ ...prev, [id]: false }));
        loadLibraries();
      }, 2000);
    } catch (err) {
      console.error(err);
      setScanning((prev) => ({ ...prev, [id]: false }));
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner" /></div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Bibliotecas</h1>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={18} /> Agregar biblioteca
        </button>
      </div>

      {libraries.length === 0 ? (
        <div className="empty-state">
          <FolderOpen size={64} />
          <h3>No hay bibliotecas configuradas</h3>
          <p>Agrega una carpeta de tu sistema que contenga videos para comenzar a escanear tu contenido multimedia.</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Ruta</th>
                <th>Tipo</th>
                <th>Último escaneo</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {libraries.map((lib) => (
                <tr key={lib.id}>
                  <td style={{ fontWeight: 500 }}>{lib.name}</td>
                  <td style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 13 }}>{lib.path}</td>
                  <td>
                    <span className={`badge badge-${lib.library_type}`}>
                      {lib.library_type === 'movies' ? 'Películas' : 'Series'}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>
                    {lib.last_scanned_at
                      ? new Date(lib.last_scanned_at).toLocaleString('es')
                      : 'Nunca'
                    }
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleScan(lib.id)}
                        disabled={scanning[lib.id]}
                        title="Escanear"
                      >
                        <RefreshCw size={14} className={scanning[lib.id] ? 'spinning' : ''} />
                        {scanning[lib.id] ? 'Escaneando...' : 'Escanear'}
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDelete(lib.id)}
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
      )}

      {/* Add Library Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="modal-title">Agregar Biblioteca</h2>
              <button className="btn-icon" onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>

            {error && <div className="login-error">{error}</div>}

            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label className="form-label">Nombre</label>
                <input
                  type="text"
                  className="form-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ej: Películas HD, Anime, Series"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Ruta de la carpeta</label>
                <input
                  type="text"
                  className="form-input"
                  value={form.path}
                  onChange={(e) => setForm({ ...form, path: e.target.value })}
                  placeholder="Ej: /videos/peliculas o /videos/series"
                  required
                />
                <small style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  Ruta dentro del contenedor Docker. La carpeta ./videos del host se monta en /videos
                </small>
              </div>

              <div className="form-group">
                <label className="form-label">Tipo de contenido</label>
                <select
                  className="form-select"
                  value={form.library_type}
                  onChange={(e) => setForm({ ...form, library_type: e.target.value })}
                >
                  <option value="movies">Películas</option>
                  <option value="series">Series</option>
                </select>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary">
                  Crear biblioteca
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        .spinning {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}

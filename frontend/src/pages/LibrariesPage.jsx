import React, { useState, useEffect, useCallback } from 'react';
import { getLibraries, createLibrary, deleteLibrary, scanLibrary, browseDirectories, generateLibraryThumbnails, extractLibrarySubtitles, autoOpenSubtitlesLibrary } from '../api';
import { FolderOpen, Plus, Trash2, RefreshCw, X, Folder, ChevronRight, ArrowUp, Search, Check, Image, Subtitles, Globe } from 'lucide-react';
import Swal from 'sweetalert2';

export default function LibrariesPage() {
  const [libraries, setLibraries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [scanning, setScanning] = useState({});
  const [generatingThumbs, setGeneratingThumbs] = useState({});
  const [extractingSubs, setExtractingSubs] = useState({});
  const [searchingOpenSub, setSearchingOpenSub] = useState({});
  const [form, setForm] = useState({ name: '', path: '', library_type: 'movies' });
  const [error, setError] = useState('');

  // Folder browser state
  const [currentPath, setCurrentPath] = useState('/host');
  const [parentPath, setParentPath] = useState(null);
  const [directories, setDirectories] = useState([]);
  const [loadingBrowse, setLoadingBrowse] = useState(false);
  const [browseError, setBrowseError] = useState('');
  const [manualPath, setManualPath] = useState('/host');

  const loadLibraries = () => {
    getLibraries()
      .then((res) => setLibraries(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadLibraries(); }, []);

  const loadDirectory = useCallback(async (dirPath) => {
    setLoadingBrowse(true);
    setBrowseError('');
    try {
      const res = await browseDirectories(dirPath);
      setCurrentPath(res.data.current);
      setParentPath(res.data.parent);
      setDirectories(res.data.directories);
      setManualPath(res.data.current);
      setForm((prev) => ({ ...prev, path: res.data.current }));
    } catch (err) {
      setBrowseError(err.response?.data?.error || 'Error al explorar el directorio');
    } finally {
      setLoadingBrowse(false);
    }
  }, []);

  const openModal = () => {
    setShowModal(true);
    setForm({ name: '', path: '', library_type: 'movies' });
    setError('');
    loadDirectory('/host');
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.path) {
      setError('Seleccioná una carpeta');
      return;
    }
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
    const result = await Swal.fire({
      title: '¿Eliminar biblioteca?',
      text: 'Se eliminará la biblioteca y todo su contenido escaneado.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#ef4444',
    });
    if (!result.isConfirmed) return;
    try {
      await deleteLibrary(id);
      loadLibraries();
    } catch (err) {
      console.error(err);
      Swal.fire({ title: 'Error', text: 'No se pudo eliminar la biblioteca', icon: 'error' });
    }
  };

  const handleScan = async (id) => {
    setScanning((prev) => ({ ...prev, [id]: true }));
    try {
      await scanLibrary(id);
      setTimeout(() => {
        setScanning((prev) => ({ ...prev, [id]: false }));
        loadLibraries();
        Swal.fire({ title: 'Escaneo completo', icon: 'success', timer: 2000, showConfirmButton: false });
      }, 2000);
    } catch (err) {
      console.error(err);
      setScanning((prev) => ({ ...prev, [id]: false }));
      Swal.fire({ title: 'Error', text: 'No se pudo escanear la biblioteca', icon: 'error' });
    }
  };

  const handleGenerateThumbs = async (id) => {
    setGeneratingThumbs((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await generateLibraryThumbnails(id);
      const taskId = res.data?.taskId;
      if (taskId && window.__ubeflix_subscribeTask) {
        window.__ubeflix_subscribeTask(taskId);
        Swal.fire({ title: 'Carátulas', text: 'Generación iniciada. Mira el progreso abajo a la derecha.', icon: 'info', timer: 2500, showConfirmButton: false });
      } else {
        Swal.fire({ title: 'Carátulas', text: res.data?.message || 'Todas las carátulas ya están generadas', icon: 'success', timer: 2500, showConfirmButton: false });
      }
    } catch (err) {
      console.error(err);
      Swal.fire({ title: 'Error', text: 'No se pudo iniciar la generación de carátulas', icon: 'error' });
    } finally {
      setGeneratingThumbs((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleExtractAllSubs = async (id) => {
    setExtractingSubs((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await extractLibrarySubtitles(id);
      const taskId = res.data?.taskId;
      if (taskId && window.__ubeflix_subscribeTask) {
        window.__ubeflix_subscribeTask(taskId);
        Swal.fire({ title: 'Subtítulos', text: 'Extracción iniciada. Mira el progreso abajo a la derecha.', icon: 'info', timer: 2500, showConfirmButton: false });
      } else {
        Swal.fire({ title: 'Subtítulos', text: res.data?.message || 'Todos los videos ya tienen subtítulos', icon: 'success', timer: 2500, showConfirmButton: false });
      }
    } catch (err) {
      console.error(err);
      Swal.fire({ title: 'Error', text: 'No se pudo iniciar la extracción de subtítulos', icon: 'error' });
    } finally {
      setExtractingSubs((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleAutoOpenSub = async (id) => {
    setSearchingOpenSub((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await autoOpenSubtitlesLibrary(id);
      const taskId = res.data?.taskId;
      if (taskId && window.__ubeflix_subscribeTask) {
        window.__ubeflix_subscribeTask(taskId);
        Swal.fire({ title: 'OpenSubtitles', text: `Buscando subtítulos para ${res.data.total} videos. Mira el progreso abajo a la derecha.`, icon: 'info', timer: 3000, showConfirmButton: false });
      } else {
        Swal.fire({ title: 'OpenSubtitles', text: res.data?.message || 'Todos los videos ya tienen subtítulos', icon: 'success', timer: 2500, showConfirmButton: false });
      }
    } catch (err) {
      console.error(err);
      Swal.fire({ title: 'Error', text: 'No se pudo iniciar la búsqueda en OpenSubtitles', icon: 'error' });
    } finally {
      setSearchingOpenSub((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleNavigate = (dirPath) => {
    loadDirectory(dirPath);
  };

  const handleGoUp = () => {
    if (parentPath) loadDirectory(parentPath);
  };

  const handleManualGo = (e) => {
    e.preventDefault();
    if (manualPath.trim()) loadDirectory(manualPath.trim());
  };

  if (loading) {
    return <div className="loading"><div className="spinner" /></div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Bibliotecas</h1>
        <button className="btn btn-primary" onClick={openModal}>
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
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleGenerateThumbs(lib.id)}
                        disabled={generatingThumbs[lib.id]}
                        title="Generar Carátulas"
                      >
                        <Image size={14} className={generatingThumbs[lib.id] ? 'spinning' : ''} />
                        {generatingThumbs[lib.id] ? 'Generando...' : 'Carátulas'}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleExtractAllSubs(lib.id)}
                        disabled={extractingSubs[lib.id]}
                        title="Extraer Subtítulos de toda la biblioteca"
                      >
                        <Subtitles size={14} className={extractingSubs[lib.id] ? 'spinning' : ''} />
                        {extractingSubs[lib.id] ? 'Extrayendo...' : 'Subtítulos'}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleAutoOpenSub(lib.id)}
                        disabled={searchingOpenSub[lib.id]}
                        title="Buscar subtítulos en OpenSubtitles para videos sin subs"
                        style={{ backgroundColor: searchingOpenSub[lib.id] ? undefined : '#2563eb' }}
                      >
                        <Globe size={14} className={searchingOpenSub[lib.id] ? 'spinning' : ''} />
                        {searchingOpenSub[lib.id] ? 'Buscando...' : 'OpenSub'}
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
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 className="modal-title" style={{ marginBottom: 0 }}>Agregar Biblioteca</h2>
              <button className="btn-icon" onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>

            {error && <div className="login-error">{error}</div>}

            <form onSubmit={handleCreate}>
              {/* Row: Name + Type */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                <div className="form-group" style={{ flex: 2, marginBottom: 0 }}>
                  <label className="form-label">Nombre</label>
                  <input
                    type="text"
                    className="form-input"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Ej: Películas HD, Anime"
                    required
                  />
                </div>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="form-label">Tipo</label>
                  <select
                    className="form-select"
                    value={form.library_type}
                    onChange={(e) => setForm({ ...form, library_type: e.target.value })}
                  >
                    <option value="movies">Películas</option>
                    <option value="series">Series</option>
                  </select>
                </div>
              </div>

              {/* Folder browser */}
              <div className="form-group">
                <label className="form-label">
                  <FolderOpen size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                  Seleccionar carpeta
                </label>

                {/* Manual path input */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <input
                    type="text"
                    className="form-input"
                    value={manualPath}
                    onChange={(e) => setManualPath(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleManualGo(e); } }}
                    placeholder="Escribí una ruta, ej: /host/f/Videos"
                    style={{ flex: 1, fontFamily: 'monospace', fontSize: 13 }}
                  />
                  <button type="button" className="btn btn-secondary" onClick={handleManualGo} style={{ whiteSpace: 'nowrap' }}>
                    <Search size={14} /> Ir
                  </button>
                </div>

                {browseError && (
                  <div style={{ color: '#ef4444', fontSize: 13, padding: '6px 10px', background: 'rgba(239,68,68,0.1)', borderRadius: 6, marginBottom: 8 }}>
                    {browseError}
                  </div>
                )}

                {/* Current path bar */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', background: 'var(--bg-tertiary, #1e1e2e)', borderRadius: 8,
                  fontSize: 13, color: 'var(--text-muted)', fontFamily: 'monospace',
                  overflowX: 'auto', whiteSpace: 'nowrap', marginBottom: 8
                }}>
                  <FolderOpen size={14} style={{ flexShrink: 0, color: 'var(--primary)' }} />
                  <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{currentPath}</span>
                  {parentPath && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={handleGoUp}
                      title="Ir a carpeta superior"
                      style={{ marginLeft: 'auto', flexShrink: 0 }}
                    >
                      <ArrowUp size={14} /> Subir
                    </button>
                  )}
                </div>

                {/* Directory listing */}
                <div style={{
                  border: '1px solid var(--border, #333)',
                  borderRadius: 8,
                  maxHeight: 240,
                  overflowY: 'auto',
                  background: 'var(--bg-secondary, #16161e)',
                }}>
                  {loadingBrowse ? (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                      <div className="spinner" style={{ margin: '0 auto 8px' }} />
                      Cargando...
                    </div>
                  ) : directories.length === 0 ? (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                      No hay subcarpetas en este directorio
                    </div>
                  ) : (
                    directories.map((dir) => (
                      <div
                        key={dir.path}
                        onClick={() => handleNavigate(dir.path)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '9px 14px',
                          cursor: 'pointer',
                          borderBottom: '1px solid var(--border, #222)',
                          transition: 'background 0.15s',
                          fontSize: 14,
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.05))'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <Folder size={18} style={{ color: dir.isDrive ? '#3b82f6' : '#f59e0b', flexShrink: 0 }} />
                        <span style={{ flex: 1 }}>{dir.name}</span>
                        <ChevronRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                      </div>
                    ))
                  )}
                </div>

                {/* Selected path indicator */}
                {form.path && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    marginTop: 10, padding: '8px 12px',
                    background: 'rgba(34, 197, 94, 0.08)', border: '1px solid rgba(34, 197, 94, 0.3)',
                    borderRadius: 8, fontSize: 13,
                  }}>
                    <Check size={16} style={{ color: '#22c55e', flexShrink: 0 }} />
                    <span style={{ color: 'var(--text-muted)' }}>Carpeta seleccionada:</span>
                    <span style={{ fontFamily: 'monospace', fontWeight: 500, color: 'var(--text-primary)' }}>{form.path}</span>
                  </div>
                )}
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={!form.path || !form.name}>
                  <Plus size={16} /> Crear biblioteca
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

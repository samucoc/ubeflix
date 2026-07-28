import React, { useState, useEffect, useMemo } from 'react';
import {
  X, Search, Download, Magnet, Users, HardDrive, Star, Loader, FolderOpen, ArrowLeft,
} from 'lucide-react';
import Swal from 'sweetalert2';
import { searchTorrents, getLibraries, startTorrentDownload } from '../api';

function formatBytes(bytes) {
  let n = Number(bytes);
  if (!n || !isFinite(n)) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function TorrentSearchModal({ initialQuery = '', onClose, onStarted }) {
  const [query, setQuery] = useState(initialQuery);
  const [sources, setSources] = useState({ yts: true, tpb: true });
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');

  // Destination step
  const [selected, setSelected] = useState(null);
  const [libraries, setLibraries] = useState([]);
  const [libraryId, setLibraryId] = useState('');
  const [locationIdx, setLocationIdx] = useState(0);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    getLibraries()
      .then((res) => {
        const movieLibs = res.data.filter((l) => l.library_type === 'movies');
        setLibraries(movieLibs);
        if (movieLibs.length) setLibraryId(String(movieLibs[0].id));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (initialQuery) handleSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeSources = useMemo(
    () => Object.entries(sources).filter(([, v]) => v).map(([k]) => k),
    [sources]
  );

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (activeSources.length === 0) { setError('Elegí al menos una fuente'); return; }
    setLoading(true);
    setError('');
    setResults(null);
    try {
      const res = await searchTorrents(q, activeSources);
      setResults(res.data.results || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al buscar torrents');
    } finally {
      setLoading(false);
    }
  };

  const selectedLibrary = libraries.find((l) => String(l.id) === String(libraryId));
  const locations = selectedLibrary
    ? (Array.isArray(selectedLibrary.locations) && selectedLibrary.locations.length
        ? selectedLibrary.locations
        : (selectedLibrary.path ? [selectedLibrary.path] : []))
    : [];

  const openDestination = (result) => {
    setSelected(result);
    setLocationIdx(0);
    if (!libraryId && libraries.length) setLibraryId(String(libraries[0].id));
  };

  const confirmDownload = async () => {
    if (!selectedLibrary) { setError('Elegí una biblioteca de películas'); return; }
    const savePath = locations[locationIdx];
    if (!savePath) { setError('Esta biblioteca no tiene ubicaciones configuradas'); return; }

    setStarting(true);
    try {
      await startTorrentDownload({
        magnet: selected.magnet,
        infoHash: selected.infoHash,
        libraryId: Number(libraryId),
        savePath,
        name: selected.name,
        poster: selected.poster,
        quality: selected.quality,
        year: selected.year,
        source: selected.source,
      });
      Swal.fire({
        title: 'Descarga iniciada',
        text: 'Podés seguir el progreso en la sección de descargas.',
        icon: 'success',
        timer: 2200,
        showConfirmButton: false,
      });
      if (onStarted) onStarted();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo iniciar la descarga');
      setStarting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 820, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 className="modal-title" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Magnet size={20} /> Buscar y descargar torrent
          </h2>
          <button className="btn-icon" onClick={onClose}><X size={20} /></button>
        </div>

        {/* ── Destination step ── */}
        {selected ? (
          <div>
            <button className="btn btn-secondary btn-sm" onClick={() => { setSelected(null); setError(''); }} style={{ marginBottom: 14 }}>
              <ArrowLeft size={14} /> Volver a resultados
            </button>

            <div style={{
              display: 'flex', gap: 14, padding: 12, borderRadius: 10,
              background: 'var(--bg-secondary, #16161e)', border: '1px solid var(--border, #333)', marginBottom: 16,
            }}>
              {selected.poster && (
                <img src={selected.poster} alt="" style={{ width: 64, height: 96, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{selected.name}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                  {selected.quality && <span className="badge badge-movies">{selected.quality}</span>}
                  {selected.size && <span><HardDrive size={13} style={{ verticalAlign: -2 }} /> {selected.size}</span>}
                  <span style={{ color: '#22c55e' }}><Users size={13} style={{ verticalAlign: -2 }} /> {selected.seeds} seeds</span>
                  <span style={{ textTransform: 'uppercase', opacity: 0.7 }}>{selected.source}</span>
                </div>
              </div>
            </div>

            {libraries.length === 0 ? (
              <div className="login-error">No tenés bibliotecas de tipo Películas. Creá una en Bibliotecas primero.</div>
            ) : (
              <>
                <div className="form-group">
                  <label className="form-label"><FolderOpen size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Biblioteca de destino</label>
                  <select className="form-select" value={libraryId} onChange={(e) => { setLibraryId(e.target.value); setLocationIdx(0); }}>
                    {libraries.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>

                {locations.length > 1 && (
                  <div className="form-group">
                    <label className="form-label">Carpeta</label>
                    <select className="form-select" value={locationIdx} onChange={(e) => setLocationIdx(Number(e.target.value))}>
                      {locations.map((loc, i) => (
                        <option key={loc} value={i}>{loc}</option>
                      ))}
                    </select>
                  </div>
                )}

                {locations.length === 1 && (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'monospace', marginBottom: 12 }}>
                    Se guardará en: {locations[0]}
                  </div>
                )}
              </>
            )}

            {error && <div className="login-error">{error}</div>}

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setSelected(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={confirmDownload} disabled={starting || libraries.length === 0 || locations.length === 0}>
                {starting ? <Loader size={16} className="spin" /> : <Download size={16} />}
                {starting ? 'Iniciando...' : 'Descargar aquí'}
              </button>
            </div>
          </div>
        ) : (
          /* ── Search step ── */
          <>
            <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                autoFocus
                type="text"
                className="form-input"
                placeholder="Ej: Interstellar 2014"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="submit" className="btn btn-primary" disabled={loading} style={{ whiteSpace: 'nowrap' }}>
                {loading ? <Loader size={16} className="spin" /> : <Search size={16} />} Buscar
              </button>
            </form>

            <div style={{ display: 'flex', gap: 14, marginBottom: 14, fontSize: 13, color: 'var(--text-muted)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={sources.yts} onChange={(e) => setSources((s) => ({ ...s, yts: e.target.checked }))} />
                YTS (películas)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={sources.tpb} onChange={(e) => setSources((s) => ({ ...s, tpb: e.target.checked }))} />
                ThePirateBay
              </label>
            </div>

            {error && <div className="login-error">{error}</div>}

            <div style={{ maxHeight: 420, overflowY: 'auto', margin: '0 -4px' }}>
              {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                  <div className="spinner" style={{ margin: '0 auto 10px' }} /> Buscando torrents...
                </div>
              ) : results == null ? (
                <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                  Escribí el nombre de una película y presioná Buscar.
                </div>
              ) : results.length === 0 ? (
                <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                  Sin resultados. Probá con otro término.
                </div>
              ) : (
                results.map((r, i) => (
                  <div
                    key={`${r.infoHash}-${i}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                      borderBottom: '1px solid var(--border, #222)',
                    }}
                  >
                    {r.poster ? (
                      <img src={r.poster} alt="" style={{ width: 42, height: 63, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 42, height: 63, borderRadius: 4, background: 'var(--bg-tertiary,#1e1e2e)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Magnet size={18} style={{ color: 'var(--text-muted)' }} />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.name}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 12.5, color: 'var(--text-muted)', alignItems: 'center' }}>
                        {r.quality && <span className="badge badge-movies">{r.quality}</span>}
                        {r.size && <span><HardDrive size={12} style={{ verticalAlign: -2 }} /> {r.size}</span>}
                        <span style={{ color: r.seeds > 0 ? '#22c55e' : '#ef4444' }}>
                          <Users size={12} style={{ verticalAlign: -2 }} /> {r.seeds}
                        </span>
                        {r.rating ? <span><Star size={12} style={{ verticalAlign: -2 }} /> {r.rating}</span> : null}
                        <span style={{ textTransform: 'uppercase', opacity: 0.6, fontSize: 11 }}>{r.source}</span>
                      </div>
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={() => openDestination(r)} style={{ flexShrink: 0 }}>
                      <Download size={14} /> Descargar
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

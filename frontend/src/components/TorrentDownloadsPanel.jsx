import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Download, Pause, Play, Trash2, Users, ChevronDown, ChevronUp, CheckCircle, AlertCircle, Loader, Eraser,
} from 'lucide-react';
import usePolling from '../hooks/usePolling';
import Swal from 'sweetalert2';
import { getTorrentDownloads, pauseTorrentDownload, resumeTorrentDownload, removeTorrentDownload, clearCompletedTorrents } from '../api';

function formatBytes(bytes) {
  // Values can arrive as strings (PostgreSQL BIGINT) — coerce to Number.
  let n = Number(bytes);
  if (!n || !isFinite(n)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatEta(seconds) {
  if (seconds == null || !isFinite(seconds) || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

const STATUS_LABEL = {
  queued: 'En cola',
  downloading: 'Descargando',
  completed: 'Completada',
  paused: 'Pausada',
  error: 'Error',
};

export default function TorrentDownloadsPanel({ onCompleted }) {
  const [downloads, setDownloads] = useState([]);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState({});
  const [clearing, setClearing] = useState(false);
  const timerRef = useRef(null);
  const prevCompletedRef = useRef(new Set());

  const load = useCallback(async () => {
    try {
      const res = await getTorrentDownloads();
      const list = res.data || [];
      setDownloads(list);

      // Fire onCompleted when a download newly reaches 'completed'.
      const nowCompleted = new Set(list.filter((d) => d.status === 'completed').map((d) => d.id));
      for (const id of nowCompleted) {
        if (!prevCompletedRef.current.has(id)) {
          if (onCompleted) onCompleted();
          break;
        }
      }
      prevCompletedRef.current = nowCompleted;
    } catch {
      /* ignore transient errors */
    }
  }, [onCompleted]);

  // Cada 2 s mientras haya algo descargando; cada 15 s si está todo quieto.
  // Antes consultaba cada 2 s siempre, incluso sin descargas y en segundo plano.
  const hasActive = downloads.some((d) => ['downloading', 'queued'].includes(d.status));
  usePolling(load, { interval: 2000, idleInterval: 15000, active: hasActive });

  const withBusy = async (id, fn) => {
    setBusy((b) => ({ ...b, [id]: true }));
    try { await fn(); await load(); }
    catch (err) { Swal.fire({ title: 'Error', text: err.response?.data?.error || 'Operación fallida', icon: 'error' }); }
    finally { setBusy((b) => ({ ...b, [id]: false })); }
  };

  const handleRemove = async (dl) => {
    const result = await Swal.fire({
      title: '¿Eliminar descarga?',
      text: dl.status === 'completed'
        ? 'Podés quitarla de la lista y conservar el archivo, o borrar también el archivo del disco.'
        : 'Se cancelará la descarga.',
      icon: 'warning',
      showCancelButton: true,
      showDenyButton: dl.status === 'completed',
      confirmButtonText: dl.status === 'completed' ? 'Quitar de la lista' : 'Cancelar descarga',
      denyButtonText: 'Borrar archivo también',
      cancelButtonText: 'Volver',
      confirmButtonColor: '#6b7280',
      denyButtonColor: '#ef4444',
    });
    if (result.isDismissed) return;
    const deleteFiles = result.isDenied;
    await withBusy(dl.id, () => removeTorrentDownload(dl.id, deleteFiles));
  };

  const handleClearCompleted = async (e) => {
    e.stopPropagation();
    setClearing(true);
    try {
      await clearCompletedTorrents();
      await load();
    } catch (err) {
      Swal.fire({ title: 'Error', text: err.response?.data?.error || 'No se pudo limpiar', icon: 'error' });
    } finally {
      setClearing(false);
    }
  };

  if (downloads.length === 0) return null;

  const active = downloads.filter((d) => ['downloading', 'queued'].includes(d.status)).length;
  const completedCount = downloads.filter((d) => d.status === 'completed').length;

  return (
    <div style={{
      border: '1px solid var(--border, #333)', borderRadius: 12,
      background: 'var(--bg-secondary, #16161e)', marginBottom: 24, overflow: 'hidden',
    }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', cursor: 'pointer', userSelect: 'none' }}
      >
        <Download size={18} style={{ color: 'var(--primary)' }} />
        <span style={{ fontWeight: 600 }}>Descargas de torrent</span>
        {active > 0 && (
          <span className="badge badge-movies" style={{ marginLeft: 2 }}>{active} activa{active > 1 ? 's' : ''}</span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {completedCount > 0 && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleClearCompleted}
              disabled={clearing}
              title="Quitar del listado las descargas completadas (no borra los archivos)"
            >
              <Eraser size={14} className={clearing ? 'spin' : ''} />
              {clearing ? 'Limpiando...' : `Limpiar completadas (${completedCount})`}
            </button>
          )}
          <span style={{ color: 'var(--text-muted)', display: 'inline-flex' }}>
            {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </span>
        </div>
      </div>

      {open && (
        <div style={{ borderTop: '1px solid var(--border, #222)' }}>
          {downloads.map((dl) => {
            const pct = Math.max(0, Math.min(100, Math.round((Number(dl.progress) || 0) * 100)));
            const isDownloading = dl.status === 'downloading';
            const totalSize = Number(dl.total_size) || 0;
            const dlSpeed = Number(dl.download_speed) || 0;
            return (
              <div key={dl.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border, #222)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ flexShrink: 0 }}>
                    {dl.status === 'completed' ? <CheckCircle size={16} style={{ color: '#22c55e' }} />
                      : dl.status === 'error' ? <AlertCircle size={16} style={{ color: '#ef4444' }} />
                      : dl.status === 'paused' ? <Pause size={16} style={{ color: '#f59e0b' }} />
                      : <Loader size={16} className="spin" style={{ color: 'var(--primary)' }} />}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {dl.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {STATUS_LABEL[dl.status] || dl.status}
                      {dl.library_name ? ` · ${dl.library_name}` : ''}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {isDownloading && (
                      <button className="btn btn-secondary btn-sm" title="Pausar" disabled={busy[dl.id]}
                        onClick={() => withBusy(dl.id, () => pauseTorrentDownload(dl.id))}>
                        <Pause size={14} />
                      </button>
                    )}
                    {(dl.status === 'paused' || dl.status === 'error') && (
                      <button className="btn btn-secondary btn-sm" title="Reanudar" disabled={busy[dl.id]}
                        onClick={() => withBusy(dl.id, () => resumeTorrentDownload(dl.id))}>
                        <Play size={14} />
                      </button>
                    )}
                    <button className="btn btn-danger btn-sm" title="Eliminar" disabled={busy[dl.id]}
                      onClick={() => handleRemove(dl)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Progress bar */}
                <div style={{ height: 6, borderRadius: 4, background: 'var(--bg-tertiary, #1e1e2e)', overflow: 'hidden' }}>
                  <div style={{
                    width: `${pct}%`, height: '100%',
                    background: dl.status === 'completed' ? '#22c55e' : dl.status === 'error' ? '#ef4444' : 'var(--primary, #6366f1)',
                    transition: 'width 0.4s ease',
                  }} />
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                  <span>{pct}%</span>
                  {totalSize > 0 && <span>{formatBytes(dl.downloaded)} / {formatBytes(totalSize)}</span>}
                  {isDownloading && dlSpeed > 0 && <span>↓ {formatBytes(dlSpeed)}/s</span>}
                  {isDownloading && <span><Users size={12} style={{ verticalAlign: -2 }} /> {dl.num_peers || 0}</span>}
                  {isDownloading && formatEta(dl.eta) && <span>ETA {formatEta(dl.eta)}</span>}
                  {dl.status === 'error' && dl.error && <span style={{ color: '#ef4444' }}>{dl.error}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getMusicPlaylists, getMusicPlaylistDetail, syncSpotifyPlaylist, resyncMusicPlaylist,
  downloadMusicPlaylist, downloadMusicTrack, getMusicStreamUrl, getMusicDownloadStatus,
  deleteMusicPlaylist, updateMusicPlaylist
} from '../api';
import {
  Music, Plus, Download, Play, Pause, SkipBack, SkipForward,
  Trash2, RefreshCw, Loader, Volume2, ChevronLeft, Clock, Disc3, X,
  Repeat, Repeat1, Shuffle, Pencil
} from 'lucide-react';
import usePolling from '../hooks/usePolling';

function formatDuration(ms) {
  if (!ms) return '--:--';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function formatDurationSec(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function MusicPage() {
  const { user } = useAuth();
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [playlistDetail, setPlaylistDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncUrl, setSyncUrl] = useState('');
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState({});
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', description: '', image_url: '' });

  // Player state
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [repeatMode, setRepeatMode] = useState('off'); // 'off' | 'all' | 'one'
  const [shuffleOn, setShuffleOn] = useState(false);
  const audioRef = useRef(null);
  const progressPollRef = useRef(null);

  const loadPlaylists = useCallback(async () => {
    try {
      const res = await getMusicPlaylists();
      setPlaylists(res.data);
    } catch (err) {
      console.error('Error loading playlists:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlaylists();
  }, [loadPlaylists]);

  const loadPlaylistDetail = useCallback(async (id) => {
    try {
      const res = await getMusicPlaylistDetail(id);
      setPlaylistDetail(res.data);
    } catch (err) {
      console.error('Error loading playlist detail:', err);
    }
  }, []);

  useEffect(() => {
    if (selectedPlaylist) {
      loadPlaylistDetail(selectedPlaylist);
    }
  }, [selectedPlaylist, loadPlaylistDetail]);

  // Estado de descarga de la playlist abierta. Sólo consulta seguido mientras
  // haya tracks pendientes o bajando; si está todo listo, cada 30 s.
  const pollDownloads = useCallback(async () => {
    if (!selectedPlaylist) return;
    try {
      const res = await getMusicDownloadStatus(selectedPlaylist);
      setDownloadStatus(res.data);
    } catch { /* ignore */ }
    await loadPlaylistDetail(selectedPlaylist);
  }, [selectedPlaylist, loadPlaylistDetail]);

  const downloadsInFlight = (downloadStatus?.downloading || 0) + (downloadStatus?.pending || 0) > 0;

  usePolling(pollDownloads, {
    interval: 5000,
    idleInterval: 30000,
    active: downloadsInFlight,
    enabled: !!selectedPlaylist,
  });

  // Audio player events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => setCurrentTime(audio.currentTime);
    const onDur = () => setDuration(audio.duration);
    const onEnd = () => handleEndOfTrack();
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onDur);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);

    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onDur);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, [currentTrack, playlistDetail, repeatMode, shuffleOn]);

  const handleSync = async () => {
    if (!syncUrl.trim()) return;
    setSyncing(true);
    try {
      await syncSpotifyPlaylist(syncUrl.trim());
      setSyncUrl('');
      setShowSyncModal(false);
      await loadPlaylists();
    } catch (err) {
      alert(err.response?.data?.error || 'Error al sincronizar');
    } finally {
      setSyncing(false);
    }
  };

  const handleResyncPlaylist = async (id) => {
    setSyncing(true);
    try {
      const res = await resyncMusicPlaylist(id);
      await loadPlaylistDetail(id);
      await loadPlaylists();
      alert(res.data.message);
    } catch (err) {
      alert(err.response?.data?.error || 'Error al re-sincronizar');
    } finally {
      setSyncing(false);
    }
  };

  const handleDownloadPlaylist = async (id) => {
    try {
      await downloadMusicPlaylist(id);
    } catch (err) {
      alert('Error al iniciar descarga');
    }
  };

  const handleDownloadTrack = async (trackId) => {
    try {
      await downloadMusicTrack(trackId);
      setTimeout(() => loadPlaylistDetail(selectedPlaylist), 2000);
    } catch (err) {
      alert('Error al descargar');
    }
  };

  const handleDeletePlaylist = async (id) => {
    if (!confirm('¿Eliminar esta playlist y sus archivos?')) return;
    try {
      await deleteMusicPlaylist(id);
      setPlaylists(prev => prev.filter(p => p.id !== id));
      if (selectedPlaylist === id) {
        setSelectedPlaylist(null);
        setPlaylistDetail(null);
      }
    } catch (err) {
      alert('Error al eliminar');
    }
  };

  const handleOpenEdit = (pl) => {
    setEditForm({ name: pl.name || '', description: pl.description || '', image_url: pl.image_url || '' });
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    try {
      const res = await updateMusicPlaylist(selectedPlaylist, editForm);
      setPlaylistDetail(prev => ({ ...prev, ...res.data }));
      setPlaylists(prev => prev.map(p => p.id === selectedPlaylist ? { ...p, ...res.data } : p));
      setShowEditModal(false);
    } catch (err) {
      alert(err.response?.data?.error || 'Error al guardar');
    }
  };

  const playTrack = (track) => {
    if (track.download_status !== 'ready') return;
    const url = getMusicStreamUrl(track.id);
    setCurrentTrack(track);
    setCurrentTime(0);
    setDuration(0);
    if (audioRef.current) {
      audioRef.current.src = url;
      audioRef.current.play().catch(() => {});
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) audioRef.current.pause();
    else audioRef.current.play().catch(() => {});
  };

  const handleSeek = (e) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = pct * duration;
  };

  const getReadyTracks = () => playlistDetail?.tracks?.filter(t => t.download_status === 'ready') || [];

  const handleEndOfTrack = () => {
    if (repeatMode === 'one') {
      // Repeat current track
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {});
      }
      return;
    }
    handleNext();
  };

  const handlePrev = () => {
    if (!playlistDetail?.tracks || !currentTrack) return;
    const readyTracks = getReadyTracks();
    const idx = readyTracks.findIndex(t => t.id === currentTrack.id);
    if (idx > 0) {
      playTrack(readyTracks[idx - 1]);
    } else if (repeatMode === 'all' && readyTracks.length > 0) {
      playTrack(readyTracks[readyTracks.length - 1]);
    }
  };

  const handleNext = () => {
    if (!playlistDetail?.tracks || !currentTrack) return;
    const readyTracks = getReadyTracks();
    if (readyTracks.length === 0) return;

    if (shuffleOn) {
      const others = readyTracks.filter(t => t.id !== currentTrack.id);
      if (others.length > 0) {
        playTrack(others[Math.floor(Math.random() * others.length)]);
      } else {
        playTrack(readyTracks[0]);
      }
      return;
    }

    const idx = readyTracks.findIndex(t => t.id === currentTrack.id);
    if (idx < readyTracks.length - 1) {
      playTrack(readyTracks[idx + 1]);
    } else if (repeatMode === 'all') {
      playTrack(readyTracks[0]);
    } else {
      setIsPlaying(false);
    }
  };

  const cycleRepeat = () => {
    setRepeatMode(prev => prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off');
  };

  if (loading) {
    return <div className="loading"><div className="spinner" /></div>;
  }

  return (
    <div className="music-page">
      <audio ref={audioRef} preload="auto" />

      <div className="music-header">
        <h1 className="page-title">
          <Music size={28} style={{ marginRight: 10 }} />
          Música
        </h1>
        {user?.is_admin && (
          <button className="btn btn-primary" onClick={() => setShowSyncModal(true)}>
            <Plus size={18} /> Agregar Playlist
          </button>
        )}
      </div>

      {/* Sync Modal */}
      {showSyncModal && (
        <div className="music-modal-overlay" onClick={() => setShowSyncModal(false)}>
          <div className="music-modal" onClick={(e) => e.stopPropagation()}>
            <div className="music-modal-header">
              <h3>Sincronizar Playlist de Spotify</h3>
              <button className="btn-icon" onClick={() => setShowSyncModal(false)}><X size={20} /></button>
            </div>
            <div className="music-modal-body">
              <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
                Pega el enlace de una playlist pública de Spotify
              </p>
              <input
                type="text"
                className="form-input"
                placeholder="https://open.spotify.com/playlist/..."
                value={syncUrl}
                onChange={(e) => setSyncUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSync()}
                autoFocus
              />
            </div>
            <div className="music-modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowSyncModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSync} disabled={syncing || !syncUrl.trim()}>
                {syncing ? <><Loader size={16} className="spinning" /> Sincronizando...</> : <><RefreshCw size={16} /> Sincronizar</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Playlist Modal */}
      {showEditModal && (
        <div className="music-modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="music-modal" onClick={(e) => e.stopPropagation()}>
            <div className="music-modal-header">
              <h3>Editar Playlist</h3>
              <button className="btn-icon" onClick={() => setShowEditModal(false)}><X size={20} /></button>
            </div>
            <div className="music-modal-body">
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, color: 'var(--text-secondary)', fontSize: 14 }}>Nombre</label>
                <input
                  type="text"
                  className="form-input"
                  value={editForm.name}
                  onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, color: 'var(--text-secondary)', fontSize: 14 }}>Descripción</label>
                <textarea
                  className="form-input"
                  rows={3}
                  value={editForm.description}
                  onChange={(e) => setEditForm(f => ({ ...f, description: e.target.value }))}
                  style={{ resize: 'vertical' }}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, color: 'var(--text-secondary)', fontSize: 14 }}>URL de carátula</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="https://..."
                  value={editForm.image_url}
                  onChange={(e) => setEditForm(f => ({ ...f, image_url: e.target.value }))}
                />
              </div>
              {editForm.image_url && (
                <div style={{ marginTop: 8 }}>
                  <img src={editForm.image_url} alt="Preview" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8 }} />
                </div>
              )}
            </div>
            <div className="music-modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowEditModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSaveEdit} disabled={!editForm.name.trim()}>
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Playlist List */}
      {!selectedPlaylist && (
        <div className="music-playlists-grid">
          {playlists.length === 0 ? (
            <div className="empty-state">
              <Music size={48} />
              <h3>No hay playlists</h3>
              <p>Agrega una playlist de Spotify para comenzar</p>
            </div>
          ) : (
            playlists.map((pl) => (
              <div key={pl.id} className="music-playlist-card" onClick={() => setSelectedPlaylist(pl.id)}>
                <div className="music-playlist-cover">
                  {pl.image_url ? (
                    <img src={pl.image_url} alt={pl.name} />
                  ) : (
                    <div className="music-playlist-cover-placeholder"><Disc3 size={40} /></div>
                  )}
                  <div className="music-playlist-play-overlay">
                    <Play size={32} />
                  </div>
                </div>
                <div className="music-playlist-info">
                  <h3>{pl.name}</h3>
                  <span>{pl.track_count} tracks · {pl.ready_count || 0} descargados</span>
                </div>
                {user?.is_admin && (
                  <div className="music-playlist-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="btn-icon" onClick={() => handleDownloadPlaylist(pl.id)} title="Descargar todo">
                      <Download size={16} />
                    </button>
                    <button className="btn-icon" onClick={() => { setSelectedPlaylist(pl.id); loadPlaylistDetail(pl.id).then(() => handleOpenEdit(pl)); }} title="Editar">
                      <Pencil size={16} />
                    </button>
                    <button className="btn-icon" onClick={() => handleDeletePlaylist(pl.id)} title="Eliminar">
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Playlist Detail */}
      {selectedPlaylist && playlistDetail && (
        <div className="music-detail">
          <button className="btn btn-secondary music-back-btn" onClick={() => { setSelectedPlaylist(null); setPlaylistDetail(null); }}>
            <ChevronLeft size={18} /> Volver
          </button>

          <div className="music-detail-header">
            <div className="music-detail-cover">
              {playlistDetail.image_url ? (
                <img src={playlistDetail.image_url} alt={playlistDetail.name} />
              ) : (
                <div className="music-playlist-cover-placeholder"><Disc3 size={60} /></div>
              )}
            </div>
            <div className="music-detail-info">
              <h2>{playlistDetail.name}</h2>
              <p>{playlistDetail.description}</p>
              <span className="music-detail-meta">
                {playlistDetail.owner} · {playlistDetail.track_count} tracks
              </span>
              {user?.is_admin && (
                <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => handleOpenEdit(playlistDetail)}>
                    <Pencil size={16} /> Editar
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={() => handleResyncPlaylist(selectedPlaylist)} disabled={syncing}>
                    {syncing ? <><Loader size={16} className="spinning" /> Sincronizando...</> : <><RefreshCw size={16} /> Re-sincronizar</>}
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={() => handleDownloadPlaylist(selectedPlaylist)}>
                    <Download size={16} /> Descargar todo
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDeletePlaylist(selectedPlaylist)}>
                    <Trash2 size={16} /> Eliminar
                  </button>
                </div>
              )}
              {downloadStatus && (
                <div className="music-download-status">
                  {downloadStatus.ready > 0 && <span className="badge badge-success">{downloadStatus.ready} listos</span>}
                  {downloadStatus.downloading > 0 && <span className="badge badge-warning">{downloadStatus.downloading} descargando</span>}
                  {downloadStatus.pending > 0 && <span className="badge badge-secondary">{downloadStatus.pending} pendientes</span>}
                  {downloadStatus.failed > 0 && <span className="badge badge-danger">{downloadStatus.failed} fallidos</span>}
                </div>
              )}
            </div>
          </div>

          {/* Track list */}
          <div className="music-track-list">
            <div className="music-track-header">
              <span className="music-track-num">#</span>
              <span className="music-track-title-col">Título</span>
              <span className="music-track-album">Álbum</span>
              <span className="music-track-duration"><Clock size={14} /></span>
              <span className="music-track-status">Estado</span>
            </div>
            {playlistDetail.tracks?.map((track, idx) => (
              <div
                key={track.id}
                className={`music-track-row ${currentTrack?.id === track.id ? 'active' : ''} ${track.download_status === 'ready' ? 'playable' : ''}`}
                onClick={() => playTrack(track)}
                onDoubleClick={() => playTrack(track)}
              >
                <span className="music-track-num">
                  {currentTrack?.id === track.id && isPlaying ? (
                    <span className="music-eq"><span /><span /><span /></span>
                  ) : (
                    idx + 1
                  )}
                </span>
                <span className="music-track-title-col">
                  <div className="music-track-title-wrap">
                    {track.cover_url && <img src={track.cover_url} alt="" className="music-track-thumb" />}
                    <div>
                      <div className="music-track-name">{track.title}</div>
                      <div className="music-track-artist">{track.artist}</div>
                    </div>
                  </div>
                </span>
                <span className="music-track-album">{track.album}</span>
                <span className="music-track-duration">{formatDuration(track.duration_ms)}</span>
                <span className="music-track-status">
                  {track.download_status === 'ready' ? (
                    <span className="badge badge-success">Listo</span>
                  ) : track.download_status === 'downloading' ? (
                    <span className="badge badge-warning"><Loader size={12} className="spinning" /> Descargando</span>
                  ) : track.download_status === 'failed' ? (
                    <span className="badge badge-danger" style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); handleDownloadTrack(track.id); }}>
                      Reintentar
                    </span>
                  ) : user?.is_admin ? (
                    <button className="btn-icon" onClick={(e) => { e.stopPropagation(); handleDownloadTrack(track.id); }} title="Descargar">
                      <Download size={14} />
                    </button>
                  ) : (
                    <span className="badge badge-secondary">Pendiente</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom Player Bar */}
      {currentTrack && (
        <div className="music-player-bar">
          <div className="music-player-track">
            {currentTrack.cover_url && <img src={currentTrack.cover_url} alt="" className="music-player-cover" />}
            <div className="music-player-info">
              <div className="music-player-name">{currentTrack.title}</div>
              <div className="music-player-artist">{currentTrack.artist}</div>
            </div>
          </div>

          <div className="music-player-controls">
            <button className={`btn-icon music-ctrl-btn ${shuffleOn ? 'active' : ''}`} onClick={() => setShuffleOn(p => !p)} title="Aleatorio">
              <Shuffle size={18} />
            </button>
            <button className="btn-icon" onClick={handlePrev}><SkipBack size={20} /></button>
            <button className="btn-icon music-play-btn" onClick={togglePlay}>
              {isPlaying ? <Pause size={24} /> : <Play size={24} />}
            </button>
            <button className="btn-icon" onClick={handleNext}><SkipForward size={20} /></button>
            <button className={`btn-icon music-ctrl-btn ${repeatMode !== 'off' ? 'active' : ''}`} onClick={cycleRepeat} title={repeatMode === 'one' ? 'Repetir canción' : repeatMode === 'all' ? 'Repetir playlist' : 'Repetir'}>
              {repeatMode === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}
            </button>
          </div>

          <div className="music-player-progress">
            <span className="music-player-time">{formatDurationSec(currentTime)}</span>
            <div className="music-progress-bar" onClick={handleSeek}>
              <div className="music-progress-fill" style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }} />
            </div>
            <span className="music-player-time">{formatDurationSec(duration)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

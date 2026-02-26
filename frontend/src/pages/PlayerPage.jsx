import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getVideo, saveProgress, getProgress, getSubtitles,
  extractSubtitles, getSubtitleFileUrl, deleteSubtitle,
  searchOpenSubtitles, downloadOpenSub, uploadSubtitle
} from '../api';
import { useAuth } from '../context/AuthContext';
import {
  ArrowLeft, Loader, Subtitles, Volume2, VolumeX,
  Maximize, Minimize, Play, Pause, SkipBack, SkipForward,
  Trash2, Download, Search, Globe, Check, Upload
} from 'lucide-react';
import Hls from 'hls.js';

export default function PlayerPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.is_admin;

  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const containerRef = useRef(null);
  const progressInterval = useRef(null);
  const savedTime = useRef(0);
  const hideTimer = useRef(null);
  const seekBarRef = useRef(null);

  const [video, setVideo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [videoError, setVideoError] = useState(false);
  const [transcoding, setTranscoding] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [seeking, setSeeking] = useState(false);

  const [subs, setSubs] = useState([]);
  const [subsLoaded, setSubsLoaded] = useState(false);
  const [subsExtracting, setSubsExtracting] = useState(false);
  const [activeSubTrack, setActiveSubTrack] = useState(-1);
  const [showSubMenu, setShowSubMenu] = useState(false);

  const [showSubManager, setShowSubManager] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [downloading, setDownloading] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const formatTime = (s) => {
    if (!s || isNaN(s)) return '0:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (playing && !showSubMenu && !showSubManager) setShowControls(false);
    }, 3000);
  }, [playing, showSubMenu, showSubManager]);

  // Fetch video + progress
  useEffect(() => {
    Promise.all([getVideo(id), getProgress(id)])
      .then(([videoRes, progressRes]) => {
        setVideo(videoRes.data);
        if (progressRes.data?.progress_seconds > 0) savedTime.current = progressRes.data.progress_seconds;
      })
      .catch(console.error)
      .finally(() => setLoading(false));

    setSubsExtracting(true);
    getSubtitles(id)
      .then(res => {
        const existing = res.data || [];
        if (existing.length > 0) {
          setSubs(existing); setSubsLoaded(true); setSubsExtracting(false);
        } else {
          extractSubtitles(id).catch(() => {}).finally(() => {
            getSubtitles(id).then(res2 => setSubs(res2.data || [])).catch(() => {})
              .finally(() => { setSubsLoaded(true); setSubsExtracting(false); });
          });
        }
      })
      .catch(() => { setSubsLoaded(true); setSubsExtracting(false); });

    progressInterval.current = setInterval(() => {
      if (videoRef.current && !videoRef.current.paused && videoRef.current.duration) {
        saveProgress(id, {
          progress_seconds: Math.floor(videoRef.current.currentTime),
          completed: videoRef.current.currentTime >= videoRef.current.duration - 30,
        }).catch(() => {});
      }
    }, 10000);

    return () => {
      if (progressInterval.current) clearInterval(progressInterval.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (videoRef.current && videoRef.current.duration) {
        saveProgress(id, {
          progress_seconds: Math.floor(videoRef.current.currentTime),
          completed: videoRef.current.currentTime >= videoRef.current.duration - 30,
        }).catch(() => {});
      }
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [id]);

  // Attach subtitle tracks
  useEffect(() => {
    if (!videoRef.current || !subsLoaded || subs.length === 0) return;
    const v = videoRef.current;
    v.querySelectorAll('track').forEach(t => t.remove());
    subs.forEach((sub) => {
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = sub.label;
      track.srclang = sub.language || 'es';
      track.src = getSubtitleFileUrl(id, sub.id);
      if (sub.is_default) track.default = true;
      v.appendChild(track);
    });
    setTimeout(() => {
      if (v.textTracks) {
        for (let i = 0; i < v.textTracks.length; i++) {
          if (subs[i] && subs[i].is_default) {
            v.textTracks[i].mode = 'showing';
            setActiveSubTrack(i);
          } else {
            v.textTracks[i].mode = 'hidden';
          }
        }
      }
    }, 200);
  }, [subs, subsLoaded, id]);

  // Video events
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => { if (!seeking) setCurrentTime(v.currentTime); };
    const onDur = () => setDuration(v.duration);
    const onBuf = () => { if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1)); };
    const onVol = () => { setVolume(v.volume); setMuted(v.muted); };
    const onEnd = () => setPlaying(false);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('durationchange', onDur);
    v.addEventListener('progress', onBuf);
    v.addEventListener('volumechange', onVol);
    v.addEventListener('ended', onEnd);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('durationchange', onDur);
      v.removeEventListener('progress', onBuf);
      v.removeEventListener('volumechange', onVol);
      v.removeEventListener('ended', onEnd);
    };
  }, [seeking]);

  // Setup video source
  useEffect(() => {
    if (!video || !videoRef.current) return;
    const token = localStorage.getItem('ubeflix_token');
    const el = videoRef.current;
    const restore = () => { if (savedTime.current > 0) el.currentTime = savedTime.current; };
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

    if (video.needs_transcoding) {
      setTranscoding(true); setVideoError(false);
      const hlsUrl = `/api/videos/${id}/hls/index.m3u8?token=${encodeURIComponent(token)}`;
      if (Hls.isSupported()) {
        const hls = new Hls({
          xhrSetup: (xhr, url) => {
            if (!url.includes('token=')) {
              const sep = url.includes('?') ? '&' : '?';
              xhr.open('GET', `${url}${sep}token=${encodeURIComponent(token)}`, true);
            }
          },
          maxBufferLength: 30, maxMaxBufferLength: 60,
          fragLoadPolicy: { default: {
            maxTimeToFirstByteMs: 20000, maxLoadTimeMs: 60000,
            timeoutRetry: { maxNumRetry: 3, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
            errorRetry: { maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
          }},
        });
        hls.loadSource(hlsUrl);
        hls.attachMedia(el);
        hls.on(Hls.Events.MANIFEST_PARSED, () => { setTranscoding(false); restore(); el.play().catch(() => {}); });
        hls.on(Hls.Events.BUFFER_APPENDED, () => setTranscoding(false));
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
            else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
            else { setVideoError(true); setTranscoding(false); setErrorMessage('Error al reproducir'); }
          }
        });
        hlsRef.current = hls;
      } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
        el.src = hlsUrl;
        el.addEventListener('loadedmetadata', () => { setTranscoding(false); restore(); el.play().catch(() => {}); }, { once: true });
      } else {
        setVideoError(true); setTranscoding(false); setErrorMessage('Navegador no soportado');
      }
    } else {
      el.src = `/api/videos/${id}/stream?token=${encodeURIComponent(token)}`;
      el.addEventListener('loadedmetadata', restore, { once: true });
      el.addEventListener('canplay', () => { setVideoError(false); setTranscoding(false); }, { once: true });
      el.addEventListener('error', () => { setVideoError(true); setErrorMessage('No se pudo reproducir'); }, { once: true });
    }
  }, [video, id]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (showSubManager && e.target.tagName === 'INPUT') return;
      const v = videoRef.current;
      if (!v) return;
      switch (e.key) {
        case ' ': case 'k': e.preventDefault(); v.paused ? v.play() : v.pause(); break;
        case 'ArrowLeft': e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 10); break;
        case 'ArrowRight': e.preventDefault(); v.currentTime = Math.min(v.duration || 0, v.currentTime + 10); break;
        case 'ArrowUp': e.preventDefault(); v.volume = Math.min(1, v.volume + 0.1); break;
        case 'ArrowDown': e.preventDefault(); v.volume = Math.max(0, v.volume - 0.1); break;
        case 'f': e.preventDefault(); toggleFullscreen(); break;
        case 'm': e.preventDefault(); v.muted = !v.muted; break;
        case 'Escape': setShowSubMenu(false); setShowSubManager(false); break;
        default: break;
      }
      resetHideTimer();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [resetHideTimer, showSubManager]);

  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const togglePlay = () => { const v = videoRef.current; if (v) v.paused ? v.play() : v.pause(); resetHideTimer(); };
  const toggleMute = () => { if (videoRef.current) videoRef.current.muted = !videoRef.current.muted; };
  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen().catch(() => {});
  };
  const seek = (e) => {
    const rect = seekBarRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    videoRef.current.currentTime = pct * duration;
    setCurrentTime(pct * duration);
  };
  const handleSeekStart = (e) => { setSeeking(true); seek(e); };
  const handleSeekMove = (e) => { if (seeking) seek(e); };
  const handleSeekEnd = (e) => { if (seeking) { seek(e); setSeeking(false); } };
  const skipBack = () => { if (videoRef.current) videoRef.current.currentTime -= 10; resetHideTimer(); };
  const skipForward = () => { if (videoRef.current) videoRef.current.currentTime += 10; resetHideTimer(); };
  const handleVolumeChange = (e) => { if (videoRef.current) { videoRef.current.volume = parseFloat(e.target.value); videoRef.current.muted = false; } };

  const selectSubTrack = (index) => {
    const v = videoRef.current;
    if (!v?.textTracks) return;
    for (let i = 0; i < v.textTracks.length; i++) v.textTracks[i].mode = i === index ? 'showing' : 'hidden';
    setActiveSubTrack(index);
    setShowSubMenu(false);
  };
  const disableSubs = () => {
    const v = videoRef.current;
    if (!v?.textTracks) return;
    for (let i = 0; i < v.textTracks.length; i++) v.textTracks[i].mode = 'hidden';
    setActiveSubTrack(-1);
    setShowSubMenu(false);
  };

  const handleDeleteSub = async (subId) => {
    try {
      await deleteSubtitle(id, subId);
      const res = await getSubtitles(id);
      setSubs(res.data || []);
      setActiveSubTrack(-1);
    } catch (err) { console.error('Delete sub error:', err); }
  };
  const handleSearchSubs = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await searchOpenSubtitles(id, searchQuery);
      setSearchResults(res.data?.results || []);
    } catch (err) { console.error('Search error:', err); }
    finally { setSearching(false); }
  };
  const handleDownloadSub = async (fileId) => {
    setDownloading(fileId);
    try {
      await downloadOpenSub(id, fileId);
      const res = await getSubtitles(id);
      setSubs(res.data || []);
      setSearchResults([]);
      setShowSubManager(false);
    } catch (err) { console.error('Download error:', err); }
    finally { setDownloading(null); }
  };

  const handleUploadSub = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const label = file.name.replace(/\.[^.]+$/, '');
      await uploadSubtitle(id, file, label, 'es');
      const res = await getSubtitles(id);
      setSubs(res.data || []);
      setShowSubMenu(false);
    } catch (err) { console.error('Upload sub error:', err); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const buildTitle = () => {
    if (!video) return '';
    let t = '';
    if (video.series_title) t += video.series_title + ' - ';
    if (video.season_number != null) t += `S${String(video.season_number).padStart(2, '0')}`;
    if (video.episode_number != null) t += `E${String(video.episode_number).padStart(2, '0')} `;
    t += video.title;
    return t;
  };

  if (loading) {
    return <div className="nfx-player"><div className="loading" style={{ height: '100vh' }}><div className="spinner" /></div></div>;
  }

  return (
    <div
      className="nfx-player"
      ref={containerRef}
      onMouseMove={resetHideTimer}
      onClick={(e) => {
        if (e.target.closest('.nfx-controls') || e.target.closest('.nfx-sub-menu') || e.target.closest('.nfx-sub-manager')) return;
        togglePlay();
      }}
    >
      <video ref={videoRef} autoPlay crossOrigin="anonymous" />

      {transcoding && (
        <div className="nfx-overlay">
          <Loader size={40} className="spin" />
          <p style={{ marginTop: 12 }}>Preparando video...</p>
          <p style={{ fontSize: 12, opacity: 0.6 }}>Transcodificando</p>
        </div>
      )}

      {videoError && (
        <div className="nfx-overlay">
          <p>{errorMessage || 'Error de reproducción'}</p>
          <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => {
            setVideoError(false); setTranscoding(true);
            if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
            setVideo(prev => prev ? { ...prev } : prev);
          }}>Reintentar</button>
        </div>
      )}

      {/* Top bar */}
      <div className={`nfx-top ${showControls ? 'visible' : ''}`}>
        <button className="nfx-back" onClick={(e) => { e.stopPropagation(); navigate(-1); }}>
          <ArrowLeft size={24} />
        </button>
        <div className="nfx-title">{buildTitle()}</div>
      </div>

      {/* Center play icon */}
      {!playing && !transcoding && !videoError && duration > 0 && (
        <div className="nfx-center-play" onClick={(e) => { e.stopPropagation(); togglePlay(); }}>
          <Play size={56} fill="white" />
        </div>
      )}

      {/* Bottom controls */}
      <div className={`nfx-controls ${showControls ? 'visible' : ''}`} onClick={e => e.stopPropagation()}>
        {/* Seek bar */}
        <div className="nfx-seekbar" ref={seekBarRef}
          onMouseDown={handleSeekStart} onMouseMove={handleSeekMove}
          onMouseUp={handleSeekEnd} onMouseLeave={() => seeking && setSeeking(false)}>
          <div className="nfx-seekbar-buffered" style={{ width: `${duration ? (buffered / duration) * 100 : 0}%` }} />
          <div className="nfx-seekbar-progress" style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}>
            <div className="nfx-seekbar-thumb" />
          </div>
        </div>

        <div className="nfx-controls-row">
          <div className="nfx-controls-left">
            <button className="nfx-btn" onClick={togglePlay}>
              {playing ? <Pause size={22} /> : <Play size={22} fill="white" />}
            </button>
            <button className="nfx-btn" onClick={skipBack} title="-10s"><SkipBack size={20} /></button>
            <button className="nfx-btn" onClick={skipForward} title="+10s"><SkipForward size={20} /></button>
            <div className="nfx-volume-group">
              <button className="nfx-btn" onClick={toggleMute}>
                {muted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
              <input type="range" min="0" max="1" step="0.05"
                value={muted ? 0 : volume} onChange={handleVolumeChange}
                className="nfx-volume-slider" />
            </div>
            <span className="nfx-time">{formatTime(currentTime)} / {formatTime(duration)}</span>
          </div>

          <div className="nfx-controls-right">
            <div style={{ position: 'relative' }}>
              <button className={`nfx-btn ${subs.length > 0 ? 'active' : ''}`}
                onClick={() => { setShowSubMenu(!showSubMenu); setShowSubManager(false); }} title="Subtítulos">
                <Subtitles size={20} />
              </button>
              {showSubMenu && (
                <div className="nfx-sub-menu" onClick={e => e.stopPropagation()}>
                  <div className="nfx-sub-menu-title">Subtítulos</div>
                  <button className={`nfx-sub-option ${activeSubTrack === -1 ? 'active' : ''}`} onClick={disableSubs}>
                    Desactivados
                  </button>
                  {subs.map((sub, i) => (
                    <div key={sub.id} className="nfx-sub-option-row">
                      <button className={`nfx-sub-option ${activeSubTrack === i ? 'active' : ''}`} onClick={() => selectSubTrack(i)}>
                        {activeSubTrack === i && <Check size={14} />}
                        {sub.label}
                        {sub.source && <span className="nfx-sub-source">{sub.source}</span>}
                      </button>
                      {isAdmin && (
                        <button className="nfx-sub-delete" onClick={() => handleDeleteSub(sub.id)} title="Eliminar">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                  {isAdmin && (
                    <>
                      <button className="nfx-sub-option nfx-sub-search-btn"
                        onClick={() => { setShowSubManager(true); setShowSubMenu(false); setSearchQuery(video?.title || ''); }}>
                        <Globe size={14} /> Buscar en OpenSubtitles
                      </button>
                      <button className="nfx-sub-option nfx-sub-search-btn"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}>
                        {uploading ? <Loader size={14} className="spin" /> : <Upload size={14} />} Subir subtítulo
                      </button>
                      <input ref={fileInputRef} type="file" accept=".srt,.vtt,.ass,.ssa,.sub"
                        style={{ display: 'none' }} onChange={handleUploadSub} />
                    </>
                  )}
                  {subsExtracting && (
                    <div className="nfx-sub-option" style={{ opacity: 0.5 }}>
                      <Loader size={14} className="spin" /> Extrayendo...
                    </div>
                  )}
                </div>
              )}
            </div>
            <button className="nfx-btn" onClick={toggleFullscreen} title="Pantalla completa">
              {fullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
            </button>
          </div>
        </div>
      </div>

      {/* Admin subtitle manager */}
      {showSubManager && isAdmin && (
        <div className="nfx-sub-manager" onClick={e => e.stopPropagation()}>
          <div className="nfx-sub-manager-header">
            <Globe size={18} />
            <span>Buscar Subtítulos — OpenSubtitles</span>
            <button className="nfx-btn" onClick={() => setShowSubManager(false)} style={{ marginLeft: 'auto' }}>✕</button>
          </div>
          <div className="nfx-sub-manager-search">
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearchSubs()} placeholder="Buscar subtítulos..." autoFocus />
            <button className="btn btn-primary btn-sm" onClick={handleSearchSubs} disabled={searching}>
              {searching ? <Loader size={14} className="spin" /> : <Search size={14} />}
            </button>
          </div>
          <div className="nfx-sub-manager-results">
            {searchResults.length === 0 && !searching && (
              <div style={{ padding: 16, textAlign: 'center', color: '#666' }}>
                {searchQuery ? 'Sin resultados' : 'Escribe y busca subtítulos'}
              </div>
            )}
            {searchResults.map(r => (
              <div key={r.id || r.attributes?.files?.[0]?.file_id} className="nfx-sub-result">
                <div className="nfx-sub-result-info">
                  <span className="nfx-sub-result-name">
                    {r.attributes?.release || r.attributes?.feature_details?.movie_name || 'Subtítulo'}
                  </span>
                  <span className="nfx-sub-result-meta">
                    {r.attributes?.language} · {r.attributes?.download_count?.toLocaleString()} descargas
                    {r.attributes?.from_trusted && ' · ✓'}
                  </span>
                </div>
                <button className="btn btn-primary btn-sm"
                  onClick={() => handleDownloadSub(r.attributes?.files?.[0]?.file_id)}
                  disabled={downloading === r.attributes?.files?.[0]?.file_id}>
                  {downloading === r.attributes?.files?.[0]?.file_id ? <Loader size={14} className="spin" /> : <Download size={14} />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

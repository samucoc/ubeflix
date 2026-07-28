import React, { useState, useRef, useEffect, useCallback } from 'react';
import Hls from 'hls.js';
import { ArrowLeft, ExternalLink, Radio, Volume2, VolumeX, Maximize, Minimize, Play, Pause, AlertTriangle, Settings2 } from 'lucide-react';

const API_BASE = '/api';

const CHANNELS = [
  // --- TV Chilena ---
  { id: 'tvn',  name: 'TVN',  fullName: 'Televisión Nacional de Chile', color: '#0072CE', textColor: '#fff', website: 'https://www.tvn.cl/envivo', type: 'youtube', category: 'tv' },
  { id: '13',   name: '13',   fullName: 'Canal 13',   color: '#1a1a2e', textColor: '#00b4d8', website: 'https://www.13.cl/en-vivo', category: 'tv' },
  { id: 'chv',  name: 'CHV',  fullName: 'Chilevisión', color: '#e63946', textColor: '#fff', website: 'https://www.chilevision.cl/senal-online', category: 'tv' },
  { id: 'mega', name: 'MEGA', fullName: 'Mega',        color: '#ff6b00', textColor: '#fff', website: 'https://www.mega.cl/senal-online', category: 'tv' },
  { id: 'tvmas', name: 'TV+', fullName: 'TV+',          color: '#00a99d', textColor: '#fff', website: 'https://www.tvmas.cl/envivo', category: 'tv' },
  { id: 'zonalatina', name: 'ZONA L', fullName: 'Zona Latina', color: '#e6007e', textColor: '#fff', website: 'https://www.zonalatinatv.com', type: 'youtube', category: 'tv' },
  // --- Noticias ---
  { id: '24h',     name: '24H',      fullName: '24 Horas',      color: '#003a70', textColor: '#e53935', website: 'https://www.24horas.cl/envivo', type: 'youtube', category: 'noticias' },
  { id: 't13',     name: 'T13',      fullName: 'T13',           color: '#1a1a2e', textColor: '#00b4d8', website: 'https://www.t13.cl/en-vivo', category: 'noticias' },
  { id: 'chvn',    name: 'CHV NOT',  fullName: 'CHV Noticias',  color: '#b71c1c', textColor: '#fff', website: 'https://www.chvnoticias.cl/senal-online', category: 'noticias' },
  { id: 'cnnchile', name: 'CNN',     fullName: 'CNN Chile',     color: '#cc0000', textColor: '#fff', website: 'https://www.cnnchile.com/senal-en-vivo/', category: 'noticias' },
  { id: 'biobio',  name: 'BÍO BÍO', fullName: 'Bío Bío TV',  color: '#f37021', textColor: '#fff', website: 'https://www.biobiochile.cl', category: 'noticias' },
  { id: 'meganot', name: 'MEGA NOT', fullName: 'Meganoticias',  color: '#0d47a1', textColor: '#fff', website: 'https://www.meganoticias.cl/senal-en-vivo/meganoticias', type: 'youtube', category: 'noticias' },
  // --- Deportes ---
  { id: '13dep',     name: '13 DEP',    fullName: '13 Deportes',   color: '#1a1a2e', textColor: '#00e676', website: 'https://www.13.cl/deportes', category: 'deportes' },
  { id: '13futgo',   name: 'FutGO',     fullName: '13 FutGO',      color: '#006400', textColor: '#fff', website: 'https://www.13.cl/deportes', category: 'deportes' },
  { id: 'espn',      name: 'ESPN',      fullName: 'ESPN',          color: '#cc0000', textColor: '#fff', website: 'https://www.espn.com', category: 'deportes' },
  { id: 'espn2',     name: 'ESPN 2',    fullName: 'ESPN 2',        color: '#cc0000', textColor: '#fff', website: 'https://www.espn.com', category: 'deportes' },
  { id: 'espn3',     name: 'ESPN 3',    fullName: 'ESPN 3',        color: '#cc0000', textColor: '#fff', website: 'https://www.espn.com', category: 'deportes' },
  { id: 'espn4',     name: 'ESPN 4',    fullName: 'ESPN 4',        color: '#cc0000', textColor: '#fff', website: 'https://www.espn.com', category: 'deportes' },
  { id: 'espn5',     name: 'ESPN 5',    fullName: 'ESPN 5',        color: '#cc0000', textColor: '#fff', website: 'https://www.espn.com', category: 'deportes' },
  { id: 'espn6',     name: 'ESPN 6',    fullName: 'ESPN 6',        color: '#cc0000', textColor: '#fff', website: 'https://www.espn.com', category: 'deportes' },
  { id: 'espn7',     name: 'ESPN 7',    fullName: 'ESPN 7',        color: '#cc0000', textColor: '#fff', website: 'https://www.espn.com', category: 'deportes' },
  { id: 'espnprem',  name: 'ESPN P',    fullName: 'ESPN Premium',  color: '#b71c1c', textColor: '#ffc107', website: 'https://www.espn.com', category: 'deportes' },
  { id: 'tntsports', name: 'TNT SP',    fullName: 'TNT Sports',    color: '#1a237e', textColor: '#fff', website: 'https://www.tntsports.com.ar', category: 'deportes' },
];

const CHANNEL_SECTIONS = [
  { key: 'tv',        label: 'TV Chilena',          icon: '📺' },
  { key: 'noticias',  label: 'Canales de Noticias', icon: '📰' },
  { key: 'deportes',  label: 'Deportes',            icon: '⚽' },
];

function YouTubePlayer({ channel, onBack }) {
  const [videoId, setVideoId] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const token = localStorage.getItem('ubeflix_token');

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/livetv/youtube/${channel.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        if (data.videoId) {
          setVideoId(data.videoId);
        } else {
          setError(data.error || 'No se pudo obtener el stream');
        }
        setLoading(false);
      })
      .catch(() => {
        setError('Error de conexión');
        setLoading(false);
      });
  }, [channel.id, token]);

  useEffect(() => {
    const handleFS = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFS);
    return () => document.removeEventListener('fullscreenchange', handleFS);
  }, []);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen();
    }
  };

  return (
    <div className="livetv-player-view">
      <div className="livetv-player-header">
        <button className="btn btn-secondary" onClick={() => onBack()}>
          <ArrowLeft size={18} />
          Volver
        </button>
        <div className="livetv-player-title">
          <span className="livetv-channel-badge" style={{ background: channel.color, color: channel.textColor }}>
            {channel.name}
          </span>
          <span>{channel.fullName}</span>
          <span className="livetv-live-dot" />
          <span className="livetv-live-label">EN VIVO</span>
        </div>
        <a href={channel.website} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" title="Abrir sitio web del canal">
          <ExternalLink size={16} />
          Web
        </a>
      </div>

      <div className="livetv-player-container" ref={containerRef}>
        {loading && (
          <div className="livetv-overlay">
            <div className="spinner" />
            <p style={{ marginTop: 12, color: '#ccc' }}>Conectando a {channel.fullName}...</p>
          </div>
        )}

        {error && (
          <div className="livetv-overlay">
            <AlertTriangle size={48} color="#ef4444" />
            <p style={{ marginTop: 12, color: '#ef4444', fontWeight: 600 }}>{error}</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button className="btn btn-primary" onClick={() => { setLoading(true); setError(null); setVideoId(null); fetch(`${API_BASE}/livetv/youtube/${channel.id}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).then(d => { if (d.videoId) setVideoId(d.videoId); else setError(d.error || 'Error'); setLoading(false); }).catch(() => { setError('Error de conexión'); setLoading(false); }); }}>Reintentar</button>
              <a href={channel.website} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
                Ver en sitio web
              </a>
            </div>
          </div>
        )}

        {videoId && !error && (
          <iframe
            src={`https://www.youtube.com/embed/${videoId}?autoplay=1&mute=0&rel=0&modestbranding=1`}
            className="livetv-video"
            style={{ border: 'none', width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
          />
        )}

        {!error && !loading && videoId && (
          <div className="livetv-controls visible" style={{ pointerEvents: 'auto' }}>
            <div className="livetv-live-indicator">
              <span className="livetv-live-dot" />
              EN VIVO
            </div>
            <div style={{ flex: 1 }} />
            <button className="livetv-ctrl-btn" onClick={toggleFullscreen}>
              {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
            </button>
          </div>
        )}
      </div>

      <div className="livetv-strip">
        {CHANNELS.filter(c => c.id !== channel.id).map(ch => (
          <button
            key={ch.id}
            className="livetv-strip-btn"
            style={{ background: ch.color, color: ch.textColor }}
            onClick={() => onBack(ch)}
          >
            {ch.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function LivePlayer({ channel, onBack }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const containerRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(80);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const [levels, setLevels] = useState([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const qualityMenuRef = useRef(null);
  const hideTimer = useRef(null);

  const streamUrl = `${API_BASE}/livetv/stream/${channel.id}`;
  const token = localStorage.getItem('ubeflix_token');

  const initPlayer = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    setError(null);
    setLoading(true);

    // Destroy previous HLS instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        xhrSetup: (xhr, url) => {
          // All requests go through our proxy, always send auth
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        },
        enableWorker: true,
        lowLatencyMode: true,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        setLevels(hls.levels);
        setCurrentLevel(-1);
        video.play().then(() => setPlaying(true)).catch(() => {
          // Autoplay blocked — mute and retry
          video.muted = true;
          setMuted(true);
          video.play().then(() => setPlaying(true)).catch(console.error);
        });
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        setCurrentLevel(hls.manualLevel === -1 ? -1 : data.level);
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          console.error('HLS fatal error:', data);
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            setError('No se pudo conectar al canal. Puede estar fuera de línea.');
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            setError('Error reproduciendo el canal.');
          }
          setLoading(false);
        }
      });

      hlsRef.current = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari)
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        setLoading(false);
        video.play().then(() => setPlaying(true)).catch(console.error);
      });
      video.addEventListener('error', () => {
        setError('No se pudo conectar al canal.');
        setLoading(false);
      });
    } else {
      setError('Tu navegador no soporta reproducción HLS.');
      setLoading(false);
    }
  }, [channel.id, streamUrl, token]);

  useEffect(() => {
    initPlayer();
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [initPlayer]);

  // Close quality menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (qualityMenuRef.current && !qualityMenuRef.current.contains(e.target)) {
        setShowQualityMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectQuality = (levelIndex) => {
    if (!hlsRef.current) return;
    hlsRef.current.currentLevel = levelIndex;
    hlsRef.current.manualLevel = levelIndex;
    setCurrentLevel(levelIndex);
    setShowQualityMenu(false);
  };

  const getQualityLabel = (level) => {
    if (level.height) return `${level.height}p`;
    if (level.bitrate) return `${Math.round(level.bitrate / 1000)}k`;
    return 'Nivel';
  };

  const currentQualityLabel = currentLevel === -1
    ? 'Auto'
    : levels[currentLevel] ? getQualityLabel(levels[currentLevel]) : 'Auto';

  // Fullscreen change listener
  useEffect(() => {
    const handleFS = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFS);
    return () => document.removeEventListener('fullscreenchange', handleFS);
  }, []);

  // Auto-hide controls
  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowControls(false), 3000);
  }, []);

  useEffect(() => {
    resetHideTimer();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [resetHideTimer]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().then(() => setPlaying(true)).catch(console.error);
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  };

  const handleVolume = (e) => {
    const val = parseInt(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val / 100;
      videoRef.current.muted = val === 0;
      setMuted(val === 0);
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen();
    }
  };

  return (
    <div className="livetv-player-view">
      <div className="livetv-player-header">
        <button className="btn btn-secondary" onClick={() => onBack()}>
          <ArrowLeft size={18} />
          Volver
        </button>
        <div className="livetv-player-title">
          <span className="livetv-channel-badge" style={{ background: channel.color, color: channel.textColor }}>
            {channel.name}
          </span>
          <span>{channel.fullName}</span>
          <span className="livetv-live-dot" />
          <span className="livetv-live-label">EN VIVO</span>
        </div>
        <a href={channel.website} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" title="Abrir sitio web del canal">
          <ExternalLink size={16} />
          Web
        </a>
      </div>

      <div
        className="livetv-player-container"
        ref={containerRef}
        onMouseMove={resetHideTimer}
        onClick={resetHideTimer}
      >
        <video
          ref={videoRef}
          className="livetv-video"
          playsInline
          onClick={togglePlay}
        />

        {loading && (
          <div className="livetv-overlay">
            <div className="spinner" />
            <p style={{ marginTop: 12, color: '#ccc' }}>Conectando a {channel.fullName}...</p>
          </div>
        )}

        {error && (
          <div className="livetv-overlay">
            <AlertTriangle size={48} color="#ef4444" />
            <p style={{ marginTop: 12, color: '#ef4444', fontWeight: 600 }}>{error}</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button className="btn btn-primary" onClick={initPlayer}>Reintentar</button>
              <a href={channel.website} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
                Ver en sitio web
              </a>
            </div>
          </div>
        )}

        {/* Player controls */}
        {!error && (
          <div className={`livetv-controls ${showControls ? 'visible' : ''}`}>
            <button className="livetv-ctrl-btn" onClick={togglePlay}>
              {playing ? <Pause size={20} /> : <Play size={20} />}
            </button>

            <div className="livetv-live-indicator">
              <span className="livetv-live-dot" />
              EN VIVO
            </div>

            <div style={{ flex: 1 }} />

            <button className="livetv-ctrl-btn" onClick={toggleMute}>
              {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
            <input
              type="range"
              className="livetv-volume"
              min="0"
              max="100"
              value={muted ? 0 : volume}
              onChange={handleVolume}
              style={{
                background: `linear-gradient(to right, var(--accent) ${muted ? 0 : volume}%, rgba(255,255,255,0.2) ${muted ? 0 : volume}%)`,
              }}
            />

            {levels.length > 1 && (
              <div className="livetv-quality-wrapper" ref={qualityMenuRef}>
                <button
                  className="livetv-ctrl-btn livetv-quality-btn"
                  onClick={() => setShowQualityMenu(v => !v)}
                  title="Calidad de imagen"
                >
                  <Settings2 size={18} />
                  <span className="livetv-quality-label">{currentQualityLabel}</span>
                </button>
                {showQualityMenu && (
                  <div className="livetv-quality-menu">
                    <div className="livetv-quality-menu-title">Calidad</div>
                    <button
                      className={`livetv-quality-option${currentLevel === -1 ? ' active' : ''}`}
                      onClick={() => selectQuality(-1)}
                    >
                      Auto
                    </button>
                    {[...levels].reverse().map((level, rIdx) => {
                      const origIdx = levels.length - 1 - rIdx;
                      return (
                        <button
                          key={origIdx}
                          className={`livetv-quality-option${currentLevel === origIdx ? ' active' : ''}`}
                          onClick={() => selectQuality(origIdx)}
                        >
                          {getQualityLabel(level)}
                          {level.bitrate ? <span className="livetv-quality-bitrate">{Math.round(level.bitrate / 1000)}kbps</span> : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <button className="livetv-ctrl-btn" onClick={toggleFullscreen}>
              {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
            </button>
          </div>
        )}
      </div>

      {/* Quick-switch strip */}
      <div className="livetv-strip">
        {CHANNELS.filter(c => c.id !== channel.id).map(ch => (
          <button
            key={ch.id}
            className="livetv-strip-btn"
            style={{ background: ch.color, color: ch.textColor }}
            onClick={() => onBack(ch)}
          >
            {ch.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function LiveTVPage() {
  const [activeChannel, setActiveChannel] = useState(null);

  const handleBack = (switchTo) => {
    if (switchTo && switchTo.id) {
      // Switching to another channel
      setActiveChannel(null);
      setTimeout(() => setActiveChannel(switchTo), 50);
    } else {
      setActiveChannel(null);
    }
  };

  if (activeChannel) {
    if (activeChannel.type === 'youtube') {
      return <YouTubePlayer channel={activeChannel} onBack={handleBack} />;
    }
    return <LivePlayer channel={activeChannel} onBack={handleBack} />;
  }

  return (
    <div>
      <h1 className="page-title">
        <Radio size={28} style={{ marginRight: 10, verticalAlign: 'middle' }} />
        Canales en Vivo
      </h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24, marginTop: -8 }}>
        Televisión chilena en directo
      </p>

      {CHANNEL_SECTIONS.map(section => {
        const sectionChannels = CHANNELS.filter(ch => ch.category === section.key);
        if (sectionChannels.length === 0) return null;
        return (
          <div key={section.key} style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{section.icon}</span> {section.label}
            </h2>
            <div className="livetv-grid">
              {sectionChannels.map(ch => (
                <div
                  key={ch.id}
                  className="livetv-card"
                  onClick={() => setActiveChannel(ch)}
                >
                  <div className="livetv-card-bg" style={{ background: ch.color }}>
                    <span className="livetv-card-name" style={{ color: ch.textColor }}>
                      {ch.name}
                    </span>
                  </div>
                  <div className="livetv-card-info">
                    <span className="livetv-card-fullname">{ch.fullName}</span>
                    <span className="livetv-card-live">
                      <span className="livetv-live-dot" />
                      EN VIVO
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

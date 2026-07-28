import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getVideo, saveProgress, getProgress, getNextVideo, getSubtitles,
  extractSubtitles, getSubtitleFileUrl, deleteSubtitle,
  searchOpenSubtitles, downloadOpenSub, uploadSubtitle,
  getAudioTracks
} from '../api';
import { useAuth } from '../context/AuthContext';
import {
  ArrowLeft, Loader, Subtitles, Volume2, VolumeX,
  Maximize, Minimize, Play, Pause, SkipBack, SkipForward,
  Trash2, Download, Search, Globe, Check, Upload, RotateCcw,
  ChevronRight, Languages, Settings
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
  const [nextVideo, setNextVideo] = useState(null);
  const [showNextOverlay, setShowNextOverlay] = useState(false);
  const nextCountdown = useRef(null);
  const [nextCountdownSec, setNextCountdownSec] = useState(0);
  const fileInputRef = useRef(null);

  const [audioTracks, setAudioTracks] = useState([]);
  const [activeAudioTrack, setActiveAudioTrack] = useState(0);
  const [showAudioMenu, setShowAudioMenu] = useState(false);

  const [qualityLevels, setQualityLevels] = useState([]);
  const [qualityLevel, setQualityLevel] = useState(-1); // -1 = Auto ABR
  const [currentQuality, setCurrentQuality] = useState('Auto');
  const [showQualityMenu, setShowQualityMenu] = useState(false);

  const SUBTITLE_LINE_PERCENT = 85; // 100 = bottom, 85 = ~15% higher

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
      if (playing && !showSubMenu && !showSubManager && !showAudioMenu && !showQualityMenu) setShowControls(false);
    }, 3000);
  }, [playing, showSubMenu, showSubManager, showAudioMenu, showQualityMenu]);

  const applySubtitleOffset = useCallback((textTrack) => {
    if (!textTrack?.cues || textTrack.cues.length === 0) return;
    for (let i = 0; i < textTrack.cues.length; i++) {
      const cue = textTrack.cues[i];
      if (!cue || !("line" in cue)) continue;
      try {
        if ('snapToLines' in cue) cue.snapToLines = false;
        cue.line = SUBTITLE_LINE_PERCENT;
      } catch (_) {
        // Ignore cues that do not allow runtime positioning changes.
      }
    }
  }, [SUBTITLE_LINE_PERCENT]);

  // Fetch video + progress
  useEffect(() => {
    Promise.all([getVideo(id), getProgress(id)])
      .then(([videoRes, progressRes]) => {
        setVideo(videoRes.data);
        if (progressRes.data?.progress_seconds > 0) savedTime.current = progressRes.data.progress_seconds;
      })
      .catch(console.error)
      .finally(() => setLoading(false));

    // Fetch next video info
    getNextVideo(id).then(res => setNextVideo(res.data?.next || null)).catch(() => setNextVideo(null));

    // Fetch audio tracks
    getAudioTracks(id).then(res => {
      const tracks = res.data || [];
      setAudioTracks(tracks);
    }).catch(() => setAudioTracks([]));

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
      if (nextCountdown.current) clearInterval(nextCountdown.current);
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
      track.addEventListener('load', () => applySubtitleOffset(track.track));
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
        for (let i = 0; i < v.textTracks.length; i++) applySubtitleOffset(v.textTracks[i]);
      }
    }, 200);
  }, [subs, subsLoaded, id, applySubtitleOffset]);

  // Video events + polling for reliable UI updates
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnd = () => {
      setPlaying(false);
      // Show next video overlay with countdown
      if (nextVideoRef.current) {
        setShowNextOverlay(true);
        setNextCountdownSec(10);
        let sec = 10;
        if (nextCountdown.current) clearInterval(nextCountdown.current);
        nextCountdown.current = setInterval(() => {
          sec--;
          setNextCountdownSec(sec);
          if (sec <= 0) {
            clearInterval(nextCountdown.current);
            goToNextVideo();
          }
        }, 1000);
      }
    };
    const onVol = () => { setVolume(v.volume); setMuted(v.muted); };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('volumechange', onVol);
    v.addEventListener('ended', onEnd);

    // Poll currentTime, duration and buffered every 250ms
    const interval = setInterval(() => {
      if (!v) return;
      if (v.duration && !isNaN(v.duration) && v.duration !== Infinity) {
        setDuration(v.duration);
      }
      if (!seeking) {
        setCurrentTime(v.currentTime);
      }
      if (v.buffered && v.buffered.length > 0) {
        setBuffered(v.buffered.end(v.buffered.length - 1));
      }
    }, 250);

    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('volumechange', onVol);
      v.removeEventListener('ended', onEnd);
      clearInterval(interval);
    };
  }, [seeking]);

  // Setup video source
  useEffect(() => {
    if (!video || !videoRef.current) return;
    const token = localStorage.getItem('ubeflix_token');
    const el = videoRef.current;
    // Save current time before switching audio track
    const currentPos = el.currentTime || 0;
    const restore = () => {
      const t = currentPos > 0 ? currentPos : savedTime.current;
      if (t > 0) el.currentTime = t;
    };
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

    if (video.needs_transcoding) {
      setTranscoding(true); setVideoError(false);
      // Reset quality state for the new video/audio track
      setQualityLevels([]);
      setQualityLevel(-1);
      setCurrentQuality('Auto');
      const hlsUrl = `/api/videos/${id}/hls/index.m3u8?token=${encodeURIComponent(token)}&audioTrack=${activeAudioTrack}`;
      if (Hls.isSupported()) {
        const hls = new Hls({
          xhrSetup: (xhr, url) => {
            if (!url.includes('token=') || !url.includes('audioTrack=')) {
              const sep = url.includes('?') ? '&' : '?';
              const params = [];
              if (!url.includes('token=')) params.push(`token=${encodeURIComponent(token)}`);
              if (!url.includes('audioTrack=')) params.push(`audioTrack=${encodeURIComponent(activeAudioTrack)}`);
              xhr.open('GET', `${url}${sep}${params.join('&')}`, true);
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
        hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
          setTranscoding(false);
          restore();
          el.play().catch(() => {});
          // Populate quality level list from the master playlist levels
          if (hls.levels && hls.levels.length > 1) {
            setQualityLevels(hls.levels.map((l, idx) => ({
              index: idx,
              height: l.height,
              bitrate: l.bitrate,
              label: l.height ? `${l.height}p` : `Nivel ${idx + 1}`,
            })));
          }
        });
        hls.on(Hls.Events.BUFFER_APPENDED, () => setTranscoding(false));
        hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
          const level = hls.levels[data.level];
          setCurrentQuality(level?.height ? `${level.height}p` : 'Auto');
          if (level?.height) {
            console.log(`[HLS] quality switched to ${level.height}p (${Math.round((level.bitrate || 0) / 1000)} kbps)`);
          }
        });
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
      setQualityLevels([]);
      setQualityLevel(-1);
      setCurrentQuality('Direct');
      el.src = `/api/videos/${id}/stream?token=${encodeURIComponent(token)}`;
      el.addEventListener('loadedmetadata', restore, { once: true });
      el.addEventListener('canplay', () => { setVideoError(false); setTranscoding(false); }, { once: true });
      el.addEventListener('error', () => { setVideoError(true); setErrorMessage('No se pudo reproducir'); }, { once: true });
    }
  }, [video, id, activeAudioTrack]);

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
        case 'n': e.preventDefault(); if (nextVideoRef.current) goToNextVideo(); break;
        case 'Escape': setShowSubMenu(false); setShowSubManager(false); setShowAudioMenu(false); setShowQualityMenu(false); break;
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
  const skipBack = () => { if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10); resetHideTimer(); };
  const skipForward = () => { if (videoRef.current) videoRef.current.currentTime = Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + 10); resetHideTimer(); };
  const restartVideo = () => { if (videoRef.current) { videoRef.current.currentTime = 0; videoRef.current.play().catch(() => {}); } resetHideTimer(); };
  const handleVolumeChange = (e) => { if (videoRef.current) { videoRef.current.volume = parseFloat(e.target.value); videoRef.current.muted = false; } };

  // Ref to keep nextVideo accessible in event handlers
  const nextVideoRef = useRef(null);
  useEffect(() => { nextVideoRef.current = nextVideo; }, [nextVideo]);

  const goToNextVideo = () => {
    if (nextCountdown.current) clearInterval(nextCountdown.current);
    setShowNextOverlay(false);
    if (nextVideoRef.current) navigate(`/player/${nextVideoRef.current.id}`, { replace: true });
  };
  const cancelNextCountdown = () => {
    if (nextCountdown.current) clearInterval(nextCountdown.current);
    setShowNextOverlay(false);
  };

  const selectSubTrack = (index) => {
    const v = videoRef.current;
    if (!v?.textTracks) return;
    applySubtitleOffset(v.textTracks[index]);
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

  const selectAudioTrack = (trackIndex) => {
    if (trackIndex === activeAudioTrack) { setShowAudioMenu(false); return; }
    const v = videoRef.current;
    // Save current position before switching
    if (v && v.currentTime) savedTime.current = v.currentTime;
    if (video?.needs_transcoding) {
      // For HLS: changing activeAudioTrack triggers useEffect to restart HLS with new audio
      setActiveAudioTrack(trackIndex);
    } else {
      // For direct play: try native audioTracks API
      if (v && v.audioTracks && v.audioTracks.length > 1) {
        for (let i = 0; i < v.audioTracks.length; i++) {
          v.audioTracks[i].enabled = (i === trackIndex);
        }
        setActiveAudioTrack(trackIndex);
      }
    }
    setShowAudioMenu(false);
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
        if (e.target.closest('.nfx-controls') || e.target.closest('.nfx-sub-menu') || e.target.closest('.nfx-sub-manager') || e.target.closest('.nfx-audio-menu')) return;
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

      {video?.needs_transcoding && !videoError && !transcoding && (
        <div
          style={{
            position: 'absolute',
            top: 18,
            right: 18,
            zIndex: 25,
            background: 'rgba(0,0,0,0.55)',
            border: '1px solid rgba(255,255,255,0.18)',
            borderRadius: 8,
            padding: '8px 10px',
            color: '#fff',
            fontSize: 12,
            lineHeight: 1.3,
            backdropFilter: 'blur(3px)',
          }}
        >
          <div><strong>Calidad:</strong> {qualityLevel === -1 ? `${currentQuality} (Auto)` : `${currentQuality} (Manual)`}</div>
          {qualityLevels.length > 1 && <div><strong>Niveles:</strong> {qualityLevels.map((q) => q.label).join(' / ')}</div>}
        </div>
      )}

      {/* Top bar */}
      <div className={`nfx-top ${showControls ? 'visible' : ''}`}>
        <button className="nfx-back" onClick={(e) => { e.stopPropagation(); navigate(-1); }}>
          <ArrowLeft size={24} />
        </button>
        <div className="nfx-title">{buildTitle()}</div>
      </div>

      {/* Center playback controls */}
      {!transcoding && !videoError && duration > 0 && (
        <div className={`nfx-center-controls ${showControls || !playing ? 'visible' : ''}`} onClick={(e) => e.stopPropagation()}>
          <button className="nfx-center-btn" onClick={skipBack} title="-10s">
            <SkipBack size={32} />
            <span className="nfx-center-btn-label">10</span>
          </button>
          <button className="nfx-center-btn nfx-center-btn-play" onClick={togglePlay}>
            {playing ? <Pause size={40} /> : <Play size={40} fill="white" />}
          </button>
          <button className="nfx-center-btn" onClick={skipForward} title="+10s">
            <SkipForward size={32} />
            <span className="nfx-center-btn-label">10</span>
          </button>
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
            <button className="nfx-btn" onClick={restartVideo} title="Volver al inicio"><RotateCcw size={20} /></button>
            <button className="nfx-btn" onClick={skipBack} title="-10s"><SkipBack size={20} /></button>
            <button className="nfx-btn" onClick={skipForward} title="+10s"><SkipForward size={20} /></button>
            {nextVideo && (
              <button className="nfx-btn" onClick={goToNextVideo} title="Siguiente">
                <ChevronRight size={22} />
              </button>
            )}
            <div className="nfx-volume-group">
              <button className="nfx-btn" onClick={toggleMute}>
                {muted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
              <input type="range" min="0" max="1" step="0.05"
                value={muted ? 0 : volume} onChange={handleVolumeChange}
                className="nfx-volume-slider"
                style={{ background: `linear-gradient(to right, #e50914 ${(muted ? 0 : volume) * 100}%, rgba(255,255,255,0.3) ${(muted ? 0 : volume) * 100}%)` }} />
            </div>
            <span className="nfx-time">{formatTime(currentTime)} / {formatTime(duration)}</span>
          </div>

          <div className="nfx-controls-right">
            {/* Audio tracks button */}
            {audioTracks.length > 1 && (
              <div style={{ position: 'relative' }}>
                <button className="nfx-btn active"
                  onClick={() => { setShowAudioMenu(!showAudioMenu); setShowSubMenu(false); setShowSubManager(false); setShowQualityMenu(false); }} title="Audio">
                  <Languages size={20} />
                </button>
                {showAudioMenu && (
                  <div className="nfx-sub-menu nfx-audio-menu" onClick={e => e.stopPropagation()}>
                    <div className="nfx-sub-menu-title">Audio</div>
                    {audioTracks.map((track, i) => (
                      <button key={i} className={`nfx-sub-option ${activeAudioTrack === i ? 'active' : ''}`}
                        onClick={() => selectAudioTrack(i)}>
                        {activeAudioTrack === i && <Check size={14} />}
                        <span>{track.label}</span>
                        {track.channels && (
                          <span className="nfx-sub-source">
                            {track.channels >= 6 ? '5.1' : track.channels >= 8 ? '7.1' : `${track.channels}ch`}
                          </span>
                        )}
                        {track.codec && (
                          <span className="nfx-sub-source">{track.codec.toUpperCase()}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Quality selector (only for HLS with multiple renditions) */}
            {qualityLevels.length > 1 && (
              <div style={{ position: 'relative' }}>
                <button
                  className="nfx-btn active"
                  onClick={() => { setShowQualityMenu(!showQualityMenu); setShowSubMenu(false); setShowAudioMenu(false); setShowSubManager(false); }}
                  title="Calidad"
                  style={{ minWidth: 44 }}
                >
                  <Settings size={18} />
                  <span style={{ fontSize: 10, marginLeft: 2, fontWeight: 700 }}>
                    {qualityLevel === -1 ? 'AUTO' : currentQuality}
                  </span>
                </button>
                {showQualityMenu && (
                  <div className="nfx-sub-menu" onClick={e => e.stopPropagation()}>
                    <div className="nfx-sub-menu-title">Calidad</div>
                    <button
                      className={`nfx-sub-option ${qualityLevel === -1 ? 'active' : ''}`}
                      onClick={() => { if (hlsRef.current) hlsRef.current.currentLevel = -1; setQualityLevel(-1); setShowQualityMenu(false); }}
                    >
                      {qualityLevel === -1 && <Check size={14} />}
                      <span>Auto</span>
                      {qualityLevel === -1 && <span className="nfx-sub-source">{currentQuality}</span>}
                    </button>
                    {qualityLevels.map((ql) => (
                      <button
                        key={ql.index}
                        className={`nfx-sub-option ${qualityLevel === ql.index ? 'active' : ''}`}
                        onClick={() => { if (hlsRef.current) hlsRef.current.currentLevel = ql.index; setQualityLevel(ql.index); setShowQualityMenu(false); }}
                      >
                        {qualityLevel === ql.index && <Check size={14} />}
                        <span>{ql.label}</span>
                        {ql.bitrate && <span className="nfx-sub-source">{Math.round(ql.bitrate / 1000)}k</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div style={{ position: 'relative' }}>
              <button className={`nfx-btn ${subs.length > 0 ? 'active' : ''}`}
                onClick={() => { setShowSubMenu(!showSubMenu); setShowSubManager(false); setShowAudioMenu(false); setShowQualityMenu(false); }} title="Subtítulos">
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

      {/* Next video overlay */}
      {showNextOverlay && nextVideo && (
        <div className="nfx-next-overlay" onClick={e => e.stopPropagation()}>
          <div className="nfx-next-content">
            <p className="nfx-next-label">Siguiente en {nextCountdownSec}s</p>
            <p className="nfx-next-title">
              {nextVideo.series_title && `${nextVideo.series_title} — `}
              {nextVideo.season_number != null && `S${String(nextVideo.season_number).padStart(2, '0')}`}
              {nextVideo.episode_number != null && `E${String(nextVideo.episode_number).padStart(2, '0')} `}
              {nextVideo.title}
            </p>
            <div className="nfx-next-buttons">
              <button className="btn btn-primary" onClick={goToNextVideo}>
                <Play size={16} fill="white" /> Reproducir ahora
              </button>
              <button className="btn btn-secondary" onClick={cancelNextCountdown}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

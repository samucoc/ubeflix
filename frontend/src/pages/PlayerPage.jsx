import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getVideo, saveProgress, getProgress } from '../api';
import { ArrowLeft } from 'lucide-react';

export default function PlayerPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const [video, setVideo] = useState(null);
  const [loading, setLoading] = useState(true);
  const progressInterval = useRef(null);

  useEffect(() => {
    Promise.all([getVideo(id), getProgress(id)])
      .then(([videoRes, progressRes]) => {
        setVideo(videoRes.data);
        // Set initial time after video loads
        if (progressRes.data.progress_seconds > 0) {
          const savedTime = progressRes.data.progress_seconds;
          const onLoaded = () => {
            if (videoRef.current) {
              videoRef.current.currentTime = savedTime;
              videoRef.current.removeEventListener('loadedmetadata', onLoaded);
            }
          };
          if (videoRef.current) {
            videoRef.current.addEventListener('loadedmetadata', onLoaded);
          }
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));

    // Save progress periodically
    progressInterval.current = setInterval(() => {
      if (videoRef.current && !videoRef.current.paused) {
        saveProgress(id, {
          progress_seconds: Math.floor(videoRef.current.currentTime),
          completed: videoRef.current.currentTime >= videoRef.current.duration - 30,
        }).catch(() => {});
      }
    }, 10000); // Save every 10 seconds

    return () => {
      if (progressInterval.current) clearInterval(progressInterval.current);
      // Save final progress
      if (videoRef.current) {
        saveProgress(id, {
          progress_seconds: Math.floor(videoRef.current.currentTime),
          completed: videoRef.current.currentTime >= videoRef.current.duration - 30,
        }).catch(() => {});
      }
    };
  }, [id]);

  const token = localStorage.getItem('ubeflix_token');
  const streamUrl = `/api/videos/${id}/stream?token=${encodeURIComponent(token)}`;

  if (loading) {
    return (
      <div className="video-player-page">
        <div className="loading" style={{ height: '100vh' }}><div className="spinner" /></div>
      </div>
    );
  }

  return (
    <div className="video-player-page">
      <div className="video-player-header">
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft size={16} /> Volver
        </button>
        <span className="video-player-title">
          {video?.series_title && `${video.series_title} - `}
          {video?.season_number != null && `S${String(video.season_number).padStart(2, '0')}`}
          {video?.episode_number != null && `E${String(video.episode_number).padStart(2, '0')} - `}
          {video?.title}
        </span>
      </div>

      <div className="video-player-container">
        <video
          ref={videoRef}
          controls
          autoPlay
          src={streamUrl}
          style={{ background: '#000' }}
        >
          Tu navegador no soporta la reproducción de video.
        </video>
      </div>
    </div>
  );
}

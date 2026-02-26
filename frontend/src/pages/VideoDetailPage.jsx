import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getVideo, checkFavorite, toggleFavorite, getSubtitles, extractSubtitles, generateThumbnail, getThumbnailUrl, getSeriesThumbnailUrl } from '../api';
import { Play, Film, ArrowLeft, Heart, Subtitles, Check, Loader, Image } from 'lucide-react';

export default function VideoDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [video, setVideo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [favorited, setFavorited] = useState(false);
  const [subs, setSubs] = useState([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [thumbLoading, setThumbLoading] = useState(false);
  const [hasThumb, setHasThumb] = useState(false);

  useEffect(() => {
    Promise.all([getVideo(id), checkFavorite({ video_id: id })])
      .then(([videoRes, favRes]) => {
        setVideo(videoRes.data);
        setFavorited(favRes.data.favorited);
      })
      .catch(console.error)
      .finally(() => setLoading(false));

    // Check existing subtitles
    getSubtitles(id).then(res => setSubs(res.data || [])).catch(() => {});

    // Check if thumbnail exists
    const img = new window.Image();
    img.onload = () => setHasThumb(true);
    img.onerror = () => setHasThumb(false);
    img.src = getThumbnailUrl(id);
  }, [id]);

  const handleToggleFavorite = async () => {
    try {
      const res = await toggleFavorite({ video_id: parseInt(id) });
      setFavorited(res.data.favorited);
    } catch (err) {
      console.error('Favorite error:', err);
    }
  };

  const handleExtractSubs = async () => {
    setSubsLoading(true);
    try {
      await extractSubtitles(id);
      const res = await getSubtitles(id);
      setSubs(res.data || []);
    } catch (err) {
      console.error('Subtitle extraction error:', err);
    } finally {
      setSubsLoading(false);
    }
  };

  const handleGenerateThumb = async () => {
    setThumbLoading(true);
    try {
      await generateThumbnail(id);
      setHasThumb(true);
    } catch (err) {
      console.error('Thumbnail error:', err);
    } finally {
      setThumbLoading(false);
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner" /></div>;
  }

  if (!video) {
    return <div className="empty-state"><h3>Video no encontrado</h3></div>;
  }

  return (
    <div>
      <div className="detail-hero">
        <div className="detail-poster">
          <img
            src={getThumbnailUrl(video.id)}
            alt={video.title}
            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
          />
          <div className="placeholder-poster" style={{ display: 'none' }}><Film size={48} /></div>
        </div>
        <div className="detail-info">
          <button
            className="btn btn-secondary btn-sm"
            style={{ marginBottom: 16, width: 'fit-content' }}
            onClick={() => navigate(-1)}
          >
            <ArrowLeft size={16} /> Volver
          </button>
          <h1 className="detail-title">{video.title}</h1>
          <div className="detail-meta">
            {video.year && <span>{video.year}</span>}
            {video.resolution && <span>{video.resolution}</span>}
            {video.file_size && <span>{(video.file_size / (1024 * 1024 * 1024)).toFixed(2)} GB</span>}
            {video.library_name && <span>{video.library_name}</span>}
          </div>
          {video.description && (
            <p className="detail-description">{video.description}</p>
          )}
          <div className="detail-actions">
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/player/${video.id}`)}
            >
              <Play size={18} fill="white" /> Reproducir
            </button>
            <button
              className={`btn ${favorited ? 'btn-danger' : 'btn-secondary'}`}
              onClick={handleToggleFavorite}
            >
              <Heart size={18} fill={favorited ? 'white' : 'none'} />
              {favorited ? 'En favoritos' : 'Favorito'}
            </button>
            <button
              className={`btn ${subs.length > 0 ? 'btn-success' : 'btn-secondary'} btn-subs`}
              onClick={handleExtractSubs}
              disabled={subsLoading}
            >
              {subsLoading ? (
                <><Loader size={18} className="spin" /> Extrayendo...</>
              ) : subs.length > 0 ? (
                <><Check size={18} /> Subtítulos ({subs.length})</>
              ) : (
                <><Subtitles size={18} /> Subtítulos</>
              )}
            </button>
            <button
              className={`btn ${hasThumb ? 'btn-success' : 'btn-secondary'} btn-subs`}
              onClick={handleGenerateThumb}
              disabled={thumbLoading}
            >
              {thumbLoading ? (
                <><Loader size={18} className="spin" /> Generando...</>
              ) : hasThumb ? (
                <><Check size={18} /> Carátula</>
              ) : (
                <><Image size={18} /> Carátula</>
              )}
            </button>
          </div>
          <div style={{ marginTop: 16, fontSize: 13, color: 'var(--text-muted)' }}>
            Archivo: {video.original_filename}
          </div>
        </div>
      </div>
    </div>
  );
}

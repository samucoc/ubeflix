import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Film, Tv, Heart } from 'lucide-react';
import { toggleFavorite, getThumbnailUrl, getSeriesThumbnailUrl } from '../api';

export default function MediaCard({ item, type = 'movie', showProgress = false, isFavorited = false, onFavoriteToggle }) {
  const navigate = useNavigate();
  const [favorited, setFavorited] = useState(isFavorited);
  const [favLoading, setFavLoading] = useState(false);

  const [imgError, setImgError] = useState(false);

  const handleClick = () => {
    if (type === 'series' || item.video_type === 'series') {
      navigate(`/series/${item.id}`);
    } else {
      navigate(`/video/${item.id}`);
    }
  };

  const handleFavoriteClick = async (e) => {
    e.stopPropagation();
    if (favLoading) return;
    setFavLoading(true);
    try {
      const data = type === 'series' || item.video_type === 'series'
        ? { series_id: item.id }
        : { video_id: item.id };
      const res = await toggleFavorite(data);
      setFavorited(res.data.favorited);
      if (onFavoriteToggle) onFavoriteToggle(item.id, res.data.favorited);
    } catch (err) {
      console.error('Favorite error:', err);
    } finally {
      setFavLoading(false);
    }
  };

  const title = item.title || item.original_filename || 'Sin título';
  const meta = [];
  if (item.year) meta.push(item.year);
  if (item.video_type === 'episode' && item.series_title) {
    meta.push(item.series_title);
  }
  if (item.episode_count) meta.push(`${item.episode_count} episodios`);
  if (item.season_count) meta.push(`${item.season_count} temporadas`);

  // Determine poster image source
  // Priority: thumbnail endpoint (clean URL) > poster_path (may have special chars)
  const getPosterSrc = () => {
    if (type === 'series' || item.video_type === 'series') {
      return getSeriesThumbnailUrl(item.id);
    }
    // If thumbnail_path exists, use the clean thumbnail endpoint
    if (item.thumbnail_path) {
      return getThumbnailUrl(item.id);
    }
    // Fallback to poster_path with proper encoding
    if (item.poster_path) {
      return '/api/images/' + encodeURI(item.poster_path);
    }
    // Last resort: try thumbnail endpoint anyway
    return getThumbnailUrl(item.id);
  };
  const posterSrc = getPosterSrc();

  return (
    <div className="media-card" onClick={handleClick}>
      <div className="media-card-poster">
        {!imgError ? (
          <img
            src={posterSrc}
            alt={title}
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="placeholder-icon">
            {type === 'series' ? <Tv size={40} /> : <Film size={40} />}
          </div>
        )}

        <div className="media-card-overlay">
          <div className="media-card-play">
            <Play size={24} fill="white" />
          </div>
        </div>

        {/* Favorite button */}
        <button
          className={`media-card-fav ${favorited ? 'favorited' : ''}`}
          onClick={handleFavoriteClick}
          title={favorited ? 'Quitar de favoritos' : 'Agregar a favoritos'}
        >
          <Heart size={16} fill={favorited ? 'currentColor' : 'none'} />
        </button>

        {item.video_type === 'episode' && item.episode_number && (
          <div className="media-card-badge">
            S{String(item.season_number || 1).padStart(2, '0')}E{String(item.episode_number).padStart(2, '0')}
          </div>
        )}

        {/* Progress bar */}
        {showProgress && item.progress_seconds > 0 && (
          <div className="media-card-progress">
            <div
              className="media-card-progress-bar"
              style={{ width: item.duration ? `${Math.min((item.progress_seconds / item.duration) * 100, 100)}%` : '30%' }}
            />
          </div>
        )}
      </div>

      <div className="media-card-info">
        <div className="media-card-title" title={title}>{title}</div>
        {meta.length > 0 && (
          <div className="media-card-meta">{meta.join(' · ')}</div>
        )}
      </div>
    </div>
  );
}

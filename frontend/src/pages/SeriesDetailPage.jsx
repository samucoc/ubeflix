import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSeriesDetail, checkFavorite, toggleFavorite, batchCheckSubtitles, extractSubtitles, getSeriesThumbnailUrl } from '../api';
import { Play, Tv, ArrowLeft, Heart, Subtitles, Check, Loader } from 'lucide-react';

export default function SeriesDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [series, setSeries] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeSeason, setActiveSeason] = useState(0);
  const [favorited, setFavorited] = useState(false);
  const [episodeSubs, setEpisodeSubs] = useState({});
  const [extractingEp, setExtractingEp] = useState(null);
  const [subsChecked, setSubsChecked] = useState(new Set());

  useEffect(() => {
    Promise.all([getSeriesDetail(id), checkFavorite({ series_id: id })])
      .then(([seriesRes, favRes]) => {
        setSeries(seriesRes.data);
        setFavorited(favRes.data.favorited);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  // Load subtitle counts for all episodes in current season with ONE batch call
  useEffect(() => {
    if (!series) return;
    const seasons = series.seasons || [];
    const currentSeason = seasons[activeSeason];
    const episodes = currentSeason?.episodes || [];
    const uncheckedIds = episodes.map(ep => ep.id).filter(epId => !subsChecked.has(epId));
    if (uncheckedIds.length === 0) return;

    batchCheckSubtitles(uncheckedIds).then(res => {
      const counts = res.data || {};
      setEpisodeSubs(prev => {
        const next = { ...prev };
        for (const [vid, count] of Object.entries(counts)) {
          next[vid] = count;
        }
        return next;
      });
      setSubsChecked(prev => {
        const next = new Set(prev);
        uncheckedIds.forEach(id => next.add(id));
        return next;
      });
    }).catch(() => {});
  }, [series, activeSeason]);

  const handleExtractEpSubs = async (epId, e) => {
    e.stopPropagation();
    setExtractingEp(epId);
    try {
      const res = await extractSubtitles(epId);
      const total = (res.data?.embedded || 0) + (res.data?.external || 0);
      setEpisodeSubs(prev => ({ ...prev, [epId]: (prev[epId] || 0) + total }));
    } catch (err) {
      console.error('Subtitle extraction error:', err);
    } finally {
      setExtractingEp(null);
    }
  };

  const handleToggleFavorite = async () => {
    try {
      const res = await toggleFavorite({ series_id: parseInt(id) });
      setFavorited(res.data.favorited);
    } catch (err) {
      console.error('Favorite error:', err);
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner" /></div>;
  }

  if (!series) {
    return <div className="empty-state"><h3>Serie no encontrada</h3></div>;
  }

  const seasons = series.seasons || [];
  const currentSeason = seasons[activeSeason];
  const episodes = currentSeason?.episodes || [];

  const totalEpisodes = seasons.reduce((acc, s) => acc + (s.episodes?.length || 0), 0);

  return (
    <div>
      {/* Hero */}
      <div className="detail-hero">
        <div className="detail-poster">
          <img
            src={getSeriesThumbnailUrl(series.id)}
            alt={series.title}
            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
          />
          <div className="placeholder-poster" style={{ display: 'none' }}><Tv size={48} /></div>
        </div>
        <div className="detail-info">
          <button
            className="btn btn-secondary btn-sm"
            style={{ marginBottom: 16, width: 'fit-content' }}
            onClick={() => navigate('/series')}
          >
            <ArrowLeft size={16} /> Volver
          </button>
          <h1 className="detail-title">{series.title}</h1>
          <div className="detail-meta">
            {series.year && <span>{series.year}</span>}
            <span>{seasons.length} temporada{seasons.length !== 1 ? 's' : ''}</span>
            <span>{totalEpisodes} episodio{totalEpisodes !== 1 ? 's' : ''}</span>
          </div>
          {series.description && (
            <p className="detail-description">{series.description}</p>
          )}
          {episodes.length > 0 && (
            <div className="detail-actions">
              <button
                className="btn btn-primary"
                onClick={() => navigate(`/player/${episodes[0].id}`)}
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
            </div>
          )}
        </div>
      </div>

      {/* Season tabs */}
      {seasons.length > 0 && (
        <>
          <div className="season-tabs">
            {seasons.map((season, idx) => (
              <button
                key={season.id}
                className={`season-tab ${idx === activeSeason ? 'active' : ''}`}
                onClick={() => setActiveSeason(idx)}
              >
                {season.title || `Temporada ${season.season_number}`}
              </button>
            ))}
          </div>

          {/* Episode list */}
          <div className="episode-list">
            {episodes.map((ep) => {
              const subCount = episodeSubs[ep.id] || 0;
              const hasSubs = subCount > 0;
              const isExtracting = extractingEp === ep.id;
              return (
                <div
                  key={ep.id}
                  className="episode-item"
                  onClick={() => navigate(`/player/${ep.id}`)}
                >
                  <div className="episode-number">{ep.episode_number}</div>
                  <div className="episode-info">
                    <div className="episode-title">{ep.title}</div>
                    <div className="episode-meta">
                      {ep.original_filename}
                      {ep.file_size && ` · ${(ep.file_size / (1024 * 1024 * 1024)).toFixed(1)} GB`}
                    </div>
                  </div>
                  <button
                    className={`btn-icon-subs ${hasSubs ? 'has-subs' : ''}`}
                    title={hasSubs ? `${subCount} subtítulo(s)` : 'Extraer subtítulos'}
                    onClick={(e) => handleExtractEpSubs(ep.id, e)}
                    disabled={isExtracting}
                  >
                    {isExtracting ? (
                      <Loader size={16} className="spin" />
                    ) : hasSubs ? (
                      <Check size={16} />
                    ) : (
                      <Subtitles size={16} />
                    )}
                  </button>
                  <div className="episode-play"><Play size={20} /></div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

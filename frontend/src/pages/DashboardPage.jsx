import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboard } from '../api';
import { Film, Tv, MonitorPlay, FolderOpen, ChevronLeft, ChevronRight } from 'lucide-react';
import MediaCard from '../components/MediaCard';

function MediaRow({ children }) {
  const rowRef = useRef(null);

  const scroll = useCallback((dir) => {
    if (!rowRef.current) return;
    const amount = rowRef.current.clientWidth * 0.75;
    rowRef.current.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' });
  }, []);

  return (
    <div className="media-row-wrapper">
      <button className="media-row-btn left" onClick={() => scroll('left')}><ChevronLeft size={22} /></button>
      <div className="media-row" ref={rowRef}>{children}</div>
      <button className="media-row-btn right" onClick={() => scroll('right')}><ChevronRight size={22} /></button>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getDashboard()
      .then((res) => setData(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="loading"><div className="spinner" /></div>;
  }

  if (!data) {
    return <div className="empty-state"><h3>Error al cargar el dashboard</h3></div>;
  }

  const { stats, recentlyAdded, continueWatching } = data;

  return (
    <div>
      <h1 className="page-title">Inicio</h1>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-icon movies"><Film size={24} /></div>
          <div>
            <div className="stat-card-value">{stats.movies}</div>
            <div className="stat-card-label">Películas</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon series"><Tv size={24} /></div>
          <div>
            <div className="stat-card-value">{stats.series}</div>
            <div className="stat-card-label">Series</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon episodes"><MonitorPlay size={24} /></div>
          <div>
            <div className="stat-card-value">{stats.episodes}</div>
            <div className="stat-card-label">Episodios</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon libraries"><FolderOpen size={24} /></div>
          <div>
            <div className="stat-card-value">{stats.libraries}</div>
            <div className="stat-card-label">Bibliotecas</div>
          </div>
        </div>
      </div>

      {/* Continue Watching */}
      {continueWatching && continueWatching.length > 0 && (
        <div className="section">
          <div className="section-header">
            <h2 className="section-title">Continuar viendo</h2>
          </div>
          <MediaRow>
            {continueWatching.map((item) => (
              <MediaCard key={item.id} item={item} showProgress={true} />
            ))}
          </MediaRow>
        </div>
      )}

      {/* Recently Added */}
      {recentlyAdded && recentlyAdded.length > 0 && (
        <div className="section">
          <div className="section-header">
            <h2 className="section-title">Agregados recientemente</h2>
            <span className="section-link" onClick={() => navigate('/movies')}>Ver todo</span>
          </div>
          <MediaRow>
            {recentlyAdded.map((item) => (
              <MediaCard key={item.id} item={item} />
            ))}
          </MediaRow>
        </div>
      )}

      {/* Empty state */}
      {stats.movies === 0 && stats.episodes === 0 && (
        <div className="empty-state">
          <FolderOpen size={64} />
          <h3>No hay contenido aún</h3>
          <p>Agrega una biblioteca de videos desde la sección de administración para comenzar a escanear tu contenido.</p>
          <button
            className="btn btn-primary"
            style={{ marginTop: 16 }}
            onClick={() => navigate('/libraries')}
          >
            Agregar biblioteca
          </button>
        </div>
      )}
    </div>
  );
}

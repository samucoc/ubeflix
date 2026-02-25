import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getVideos } from '../api';
import MediaCard from '../components/MediaCard';
import { Film } from 'lucide-react';

export default function MoviesPage() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchParams] = useSearchParams();
  const search = searchParams.get('search') || '';

  useEffect(() => {
    setLoading(true);
    getVideos({ type: 'movie', search: search || undefined })
      .then((res) => setVideos(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [search]);

  if (loading) {
    return <div className="loading"><div className="spinner" /></div>;
  }

  return (
    <div>
      <h1 className="page-title">
        Películas
        {search && <span className="page-subtitle">Buscando: "{search}"</span>}
      </h1>

      {videos.length === 0 ? (
        <div className="empty-state">
          <Film size={64} />
          <h3>{search ? 'Sin resultados' : 'No hay películas'}</h3>
          <p>{search ? 'Intenta con otro término de búsqueda' : 'Agrega una biblioteca de películas para comenzar'}</p>
        </div>
      ) : (
        <div className="media-grid large">
          {videos.map((video) => (
            <MediaCard key={video.id} item={video} type="movie" />
          ))}
        </div>
      )}
    </div>
  );
}

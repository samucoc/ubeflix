import React, { useState, useEffect } from 'react';
import { getFavorites } from '../api';
import { Heart } from 'lucide-react';
import MediaCard from '../components/MediaCard';

export default function FavoritesPage() {
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadFavorites = () => {
    getFavorites()
      .then((res) => setFavorites(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadFavorites();
  }, []);

  const handleFavoriteToggle = (id, isFavorited) => {
    if (!isFavorited) {
      setFavorites((prev) => prev.filter((f) => f.id !== id));
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner" /></div>;
  }

  return (
    <div>
      <h1 className="page-title">Favoritos</h1>

      {favorites.length === 0 ? (
        <div className="empty-state">
          <Heart size={64} />
          <h3>No tienes favoritos aún</h3>
          <p>Marca películas y series como favoritas usando el icono de corazón para verlas aquí.</p>
        </div>
      ) : (
        <div className="media-grid large">
          {favorites.map((item) => (
            <MediaCard
              key={`${item.type}-${item.id}`}
              item={item}
              type={item.type}
              isFavorited={true}
              onFavoriteToggle={handleFavoriteToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

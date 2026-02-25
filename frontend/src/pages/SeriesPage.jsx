import React, { useState, useEffect } from 'react';
import { getSeries } from '../api';
import MediaCard from '../components/MediaCard';
import { Tv } from 'lucide-react';

export default function SeriesPage() {
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSeries()
      .then((res) => setSeries(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="loading"><div className="spinner" /></div>;
  }

  return (
    <div>
      <h1 className="page-title">Series</h1>

      {series.length === 0 ? (
        <div className="empty-state">
          <Tv size={64} />
          <h3>No hay series</h3>
          <p>Agrega una biblioteca de tipo "series" para comenzar a escanear tu contenido.</p>
        </div>
      ) : (
        <div className="media-grid large">
          {series.map((s) => (
            <MediaCard key={s.id} item={s} type="series" />
          ))}
        </div>
      )}
    </div>
  );
}

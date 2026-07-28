import React, { useMemo, useCallback } from 'react';
import { getSeries } from '../api';
import MediaCard from '../components/MediaCard';
import LoadMore from '../components/LoadMore';
import usePaginatedList from '../hooks/usePaginatedList';
import { Tv } from 'lucide-react';

export default function SeriesPage() {
  const fetchSeries = useCallback((params) => getSeries(params), []);
  const { items: series, total, hasMore, loading, loadingMore, loadMore } =
    usePaginatedList(fetchSeries);

  // Group series by library
  const libraryGroups = useMemo(() => {
    const groups = {};
    series.forEach((s) => {
      const key = s.library_id || 0;
      if (!groups[key]) {
        groups[key] = { name: s.library_name || 'Sin biblioteca', items: [] };
      }
      groups[key].items.push(s);
    });
    // Sort groups alphabetically by name
    return Object.values(groups).sort((a, b) => a.name.localeCompare(b.name));
  }, [series]);

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
        libraryGroups.map((group) => (
          <div key={group.name} className="library-section">
            <h2 className="library-section-title">{group.name}</h2>
            <div className="media-grid large">
              {group.items.map((s) => (
                <MediaCard key={s.id} item={s} type="series" />
              ))}
            </div>
          </div>
        ))
      )}

      <LoadMore
        shown={series.length}
        total={total}
        hasMore={hasMore}
        loading={loadingMore}
        onLoadMore={loadMore}
      />
    </div>
  );
}

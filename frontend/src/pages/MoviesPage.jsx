import React, { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getVideos } from '../api';
import { useAuth } from '../context/AuthContext';
import MediaCard from '../components/MediaCard';
import LoadMore from '../components/LoadMore';
import TorrentSearchModal from '../components/TorrentSearchModal';
import TorrentDownloadsPanel from '../components/TorrentDownloadsPanel';
import usePaginatedList from '../hooks/usePaginatedList';
import { Film, Magnet } from 'lucide-react';

export default function MoviesPage() {
  const { user } = useAuth();
  const [showTorrent, setShowTorrent] = useState(false);
  const [searchParams] = useSearchParams();
  const search = searchParams.get('search') || '';

  const fetchMovies = useCallback(
    (params) => getVideos({ type: 'movie', search: search || undefined, ...params }),
    [search]
  );

  const { items: videos, total, hasMore, loading, loadingMore, loadMore, reload } =
    usePaginatedList(fetchMovies);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>
          Películas
          {search && <span className="page-subtitle">Buscando: "{search}"</span>}
        </h1>
        {user?.is_admin && (
          <button className="btn btn-primary" onClick={() => setShowTorrent(true)} style={{ whiteSpace: 'nowrap' }}>
            <Magnet size={18} /> Buscar torrent
          </button>
        )}
      </div>

      {user?.is_admin && <TorrentDownloadsPanel onCompleted={reload} />}

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : videos.length === 0 ? (
        <div className="empty-state">
          <Film size={64} />
          <h3>{search ? 'Sin resultados' : 'No hay películas'}</h3>
          <p>{search ? 'Intenta con otro término de búsqueda' : 'Agrega una biblioteca de películas o descargá una con el botón "Buscar torrent"'}</p>
        </div>
      ) : (
        <>
          <div className="media-grid large">
            {videos.map((video) => (
              <MediaCard key={video.id} item={video} type="movie" />
            ))}
          </div>
          <LoadMore
            shown={videos.length}
            total={total}
            hasMore={hasMore}
            loading={loadingMore}
            onLoadMore={loadMore}
          />
        </>
      )}

      {showTorrent && (
        <TorrentSearchModal
          initialQuery={search}
          onClose={() => setShowTorrent(false)}
          onStarted={reload}
        />
      )}
    </div>
  );
}

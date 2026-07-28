import React, { useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getComics, getComicCoverUrl } from '../api';
import LoadMore from '../components/LoadMore';
import usePaginatedList from '../hooks/usePaginatedList';
import { BookOpen } from 'lucide-react';

const FORMAT_BADGE = {
  pdf: { label: 'PDF', color: '#ef4444' },
  zip: { label: 'ZIP', color: '#3b82f6' },
  cbz: { label: 'CBZ', color: '#3b82f6' },
  rar: { label: 'RAR', color: '#f59e0b' },
  cbr: { label: 'CBR', color: '#f59e0b' },
};

function ComicCard({ comic, onClick }) {
  const [coverError, setCoverError] = useState(false);
  const badge = FORMAT_BADGE[comic.format] || { label: comic.format.toUpperCase(), color: '#6b7280' };
  const coverUrl = getComicCoverUrl(comic.id);

  return (
    <div
      className="media-card"
      onClick={onClick}
      style={{ cursor: 'pointer', position: 'relative' }}
      title={comic.title}
    >
      <div className="media-card-image">
        {!coverError && comic.format !== 'pdf' ? (
          <img
            src={coverUrl}
            alt={comic.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={() => setCoverError(true)}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg, #1e1e2e 0%, #2d2d44 100%)',
            gap: 8,
          }}>
            <BookOpen size={48} style={{ color: 'var(--primary, #6366f1)', opacity: 0.7 }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '0 8px', wordBreak: 'break-word' }}>
              {comic.title}
            </span>
          </div>
        )}
        {/* Format badge */}
        <div style={{
          position: 'absolute', top: 6, right: 6,
          background: badge.color, color: '#fff',
          fontSize: 10, fontWeight: 700,
          padding: '2px 6px', borderRadius: 4,
          letterSpacing: '0.05em',
        }}>
          {badge.label}
        </div>
      </div>
      <div className="media-card-info">
        <div className="media-card-title" style={{ fontSize: 13 }}>{comic.title}</div>
        {comic.page_count > 0 && (
          <div className="media-card-meta">{comic.page_count} páginas</div>
        )}
      </div>
    </div>
  );
}

export default function ComicsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const search = searchParams.get('search') || '';

  const fetchComics = useCallback(
    (params) => getComics({ ...(search ? { search } : {}), ...params }),
    [search]
  );
  const { items: comics, total, hasMore, loading, loadingMore, loadMore } =
    usePaginatedList(fetchComics);

  if (loading) {
    return <div className="loading"><div className="spinner" /></div>;
  }

  return (
    <div>
      <h1 className="page-title">
        Comics
        {search && <span className="page-subtitle">Buscando: "{search}"</span>}
      </h1>

      {comics.length === 0 ? (
        <div className="empty-state">
          <BookOpen size={64} />
          <h3>{search ? 'Sin resultados' : 'No hay comics'}</h3>
          <p>
            {search
              ? 'Intenta con otro término de búsqueda'
              : 'Agrega una biblioteca de tipo "Comics" y escanéala para comenzar'}
          </p>
        </div>
      ) : (
        <>
          <div className="media-grid large">
            {comics.map((comic) => (
              <ComicCard
                key={comic.id}
                comic={comic}
                onClick={() => navigate(`/comics/${comic.id}`)}
              />
            ))}
          </div>
          <LoadMore
            shown={comics.length}
            total={total}
            hasMore={hasMore}
            loading={loadingMore}
            onLoadMore={loadMore}
          />
        </>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';

// El backend pagina todos los listados (películas, series, comics) y devuelve
// los totales en headers. Este hook encapsula "traer la primera página y luego
// ir sumando", que si no habría que repetir en cada página.
//
//   const fetchMovies = useCallback(
//     (params) => getVideos({ type: 'movie', ...params }), [search]);
//   const { items, total, hasMore, loading, loadMore } = usePaginatedList(fetchMovies);
//
// `fetcher` recibe { limit, offset } y devuelve la promesa de axios. Memoizalo
// con useCallback: su identidad es lo que dispara la recarga (al cambiar la
// búsqueda, por ejemplo).
export const PAGE_SIZE = 200;

export default function usePaginatedList(fetcher, { pageSize = PAGE_SIZE } = {}) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(
    (offset) =>
      Promise.resolve(fetcher({ limit: pageSize, offset })).then((res) => ({
        rows: res.data || [],
        total: parseInt(res.headers?.['x-total-count'], 10) || (res.data || []).length,
        hasMore: res.headers?.['x-has-more'] === 'true',
      })),
    [fetcher, pageSize]
  );

  const reload = useCallback(() => {
    setLoading(true);
    return fetchPage(0)
      .then(({ rows, total: t, hasMore: more }) => {
        setItems(rows);
        setTotal(t);
        setHasMore(more);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    fetchPage(items.length)
      .then(({ rows, total: t, hasMore: more }) => {
        setItems((prev) => [...prev, ...rows]);
        setTotal(t);
        setHasMore(more);
      })
      .catch(console.error)
      .finally(() => setLoadingMore(false));
  }, [fetchPage, items.length, loadingMore, hasMore]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { items, total, hasMore, loading, loadingMore, loadMore, reload };
}

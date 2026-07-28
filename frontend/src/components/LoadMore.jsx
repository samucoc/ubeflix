import React from 'react';

// Pie de listado paginado: "Mostrando N de M" + botón para traer la siguiente
// tanda. No renderiza nada cuando ya se cargó todo.
export default function LoadMore({ shown, total, hasMore, loading, onLoadMore }) {
  if (!hasMore) return null;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 8, margin: '24px 0',
    }}>
      <span className="page-subtitle">Mostrando {shown} de {total}</span>
      <button className="btn" onClick={onLoadMore} disabled={loading}>
        {loading ? 'Cargando…' : 'Cargar más'}
      </button>
    </div>
  );
}

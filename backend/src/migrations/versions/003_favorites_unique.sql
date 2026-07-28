-- Un usuario no puede tener dos veces el mismo favorito.
-- Primero se limpian los duplicados que hubiera, conservando el más antiguo.

DELETE FROM favorites f
USING favorites g
WHERE f.id > g.id
  AND f.user_id = g.user_id
  AND f.video_id IS NOT DISTINCT FROM g.video_id
  AND f.series_id IS NOT DISTINCT FROM g.series_id;

-- Índices parciales: cada fila usa video_id o series_id, nunca ambos.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_favorites_user_video
    ON favorites (user_id, video_id) WHERE video_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_favorites_user_series
    ON favorites (user_id, series_id) WHERE series_id IS NOT NULL;

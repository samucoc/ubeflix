-- Las búsquedas usan `title ILIKE '%texto%'`, patrón que un índice btree no
-- puede aprovechar (el comodín inicial lo impide). Los índices GIN de trigramas
-- sí sirven para eso.
--
-- CREATE EXTENSION necesita superusuario. Si no está disponible, se omiten los
-- índices en lugar de dejar la migración fallando en cada arranque: la búsqueda
-- sigue funcionando, sólo con seq scan.

DO $$
BEGIN
    BEGIN
        CREATE EXTENSION IF NOT EXISTS pg_trgm;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'pg_trgm no disponible (%): se omiten los índices trigram', SQLERRM;
        RETURN;
    END;

    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_videos_title_trgm ON videos USING GIN (title gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_series_title_trgm ON series USING GIN (title gin_trgm_ops)';
END $$;

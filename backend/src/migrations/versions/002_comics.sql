-- Biblioteca de comics. Antes lo creaba ensureSchema() en routes/comics.js,
-- en cada request.

CREATE TABLE IF NOT EXISTS comics (
    id            SERIAL PRIMARY KEY,
    title         VARCHAR(500) NOT NULL,
    file_path     VARCHAR(1000) NOT NULL UNIQUE,
    format        VARCHAR(10) NOT NULL,
    page_count    INTEGER DEFAULT 0,
    cover_cached  BOOLEAN DEFAULT FALSE,
    file_size     BIGINT,
    library_id    INTEGER REFERENCES libraries(id) ON DELETE SET NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_comics_library ON comics(library_id);

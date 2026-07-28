-- Varias carpetas por biblioteca. Antes lo creaba ensureLibraryLocationsSchema()
-- en routes/libraries.js, en cada request.

CREATE TABLE IF NOT EXISTS library_locations (
    id SERIAL PRIMARY KEY,
    library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    path VARCHAR(500) NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(library_id, path)
);

CREATE INDEX IF NOT EXISTS idx_library_locations_library ON library_locations(library_id);

-- Backfill: una ubicación por defecto para las bibliotecas que ya existían.
INSERT INTO library_locations (library_id, path, position)
SELECT l.id, l.path, 0
FROM libraries l
WHERE l.path IS NOT NULL
  AND l.path <> ''
  AND NOT EXISTS (
    SELECT 1 FROM library_locations ll WHERE ll.library_id = l.id
  );

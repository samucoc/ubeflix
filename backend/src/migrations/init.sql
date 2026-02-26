-- ubeFlix Database Schema

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    avatar_url VARCHAR(500),
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Libraries (video folder paths)
CREATE TABLE IF NOT EXISTS libraries (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    path VARCHAR(500) NOT NULL,
    library_type VARCHAR(20) NOT NULL DEFAULT 'movies', -- 'movies' or 'series'
    last_scanned_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Series
CREATE TABLE IF NOT EXISTS series (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    poster_path VARCHAR(500),
    banner_path VARCHAR(500),
    year INTEGER,
    library_id INTEGER REFERENCES libraries(id) ON DELETE CASCADE,
    folder_path VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seasons
CREATE TABLE IF NOT EXISTS seasons (
    id SERIAL PRIMARY KEY,
    series_id INTEGER REFERENCES series(id) ON DELETE CASCADE,
    season_number INTEGER NOT NULL,
    title VARCHAR(255),
    folder_path VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Videos (movies or episodes)
CREATE TABLE IF NOT EXISTS videos (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    original_filename VARCHAR(500) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size BIGINT,
    duration INTEGER, -- seconds
    resolution VARCHAR(20),
    video_type VARCHAR(20) NOT NULL DEFAULT 'movie', -- 'movie' or 'episode'
    year INTEGER,
    description TEXT,
    poster_path VARCHAR(500),
    banner_path VARCHAR(500),
    -- Series fields (null for movies)
    series_id INTEGER REFERENCES series(id) ON DELETE CASCADE,
    season_id INTEGER REFERENCES seasons(id) ON DELETE CASCADE,
    episode_number INTEGER,
    -- Library reference
    library_id INTEGER REFERENCES libraries(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Watch history / progress
CREATE TABLE IF NOT EXISTS watch_progress (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
    progress_seconds INTEGER DEFAULT 0,
    completed BOOLEAN DEFAULT FALSE,
    last_watched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, video_id)
);

-- Favorites
CREATE TABLE IF NOT EXISTS favorites (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    video_id INTEGER,
    series_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_video FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
    CONSTRAINT fk_series FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_videos_library ON videos(library_id);
CREATE INDEX IF NOT EXISTS idx_videos_series ON videos(series_id);
CREATE INDEX IF NOT EXISTS idx_videos_season ON videos(season_id);
CREATE INDEX IF NOT EXISTS idx_videos_type ON videos(video_type);
CREATE INDEX IF NOT EXISTS idx_series_library ON series(library_id);
CREATE INDEX IF NOT EXISTS idx_watch_progress_user ON watch_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_video ON favorites(video_id);
CREATE INDEX IF NOT EXISTS idx_favorites_series ON favorites(series_id);
CREATE INDEX IF NOT EXISTS idx_videos_title ON videos(title);

-- Insert default admin user (password: admin123)
-- Hash generated with bcryptjs: bcrypt.hashSync('admin123', 10)
INSERT INTO users (username, email, password_hash, is_admin)
VALUES ('admin', 'admin@ubeflix.local', '$2a$10$zFo7nqXhpAlrPLCozP/o0OB/rY7BGNmvkxJHPXOWdB.LK0X61k/Rm', TRUE)
ON CONFLICT (username) DO NOTHING;

-- Subtitles table
CREATE TABLE IF NOT EXISTS subtitles (
    id SERIAL PRIMARY KEY,
    video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
    label VARCHAR(100) NOT NULL DEFAULT 'Español',
    language VARCHAR(10) NOT NULL DEFAULT 'es',
    format VARCHAR(10) NOT NULL DEFAULT 'vtt', -- 'vtt', 'srt', 'ass'
    file_path VARCHAR(500) NOT NULL,
    source VARCHAR(50) DEFAULT 'embedded', -- 'embedded', 'external', 'subdivx', 'opensubtitles'
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subtitles_video ON subtitles(video_id);

-- Thumbnail path columns (may already exist, ignore errors)
DO $$ BEGIN
    ALTER TABLE videos ADD COLUMN IF NOT EXISTS thumbnail_path VARCHAR(500);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE series ADD COLUMN IF NOT EXISTS thumbnail_path VARCHAR(500);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Codec cache columns for faster video loading
DO $$ BEGIN
    ALTER TABLE videos ADD COLUMN IF NOT EXISTS video_codec VARCHAR(30);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE videos ADD COLUMN IF NOT EXISTS audio_codec VARCHAR(30);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE videos ADD COLUMN IF NOT EXISTS needs_transcoding BOOLEAN;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

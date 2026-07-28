import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('ubeflix_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses (expired/invalid token)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('ubeflix_token');
      localStorage.removeItem('ubeflix_user');
      localStorage.removeItem('ubeflix_media_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// ─── Token de media ──────────────────────────────────────────────────────
// Las URLs de <video>, <img> y los segmentos HLS no pueden mandar cabecera
// Authorization, así que llevan el token en la query — donde queda registrado
// en los logs de nginx y en el historial del navegador. Para esas URLs usamos
// un token corto que sólo sirve para leer media, no el de sesión de 7 días.
const MEDIA_TOKEN_KEY = 'ubeflix_media_token';
const MEDIA_TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000; // renovar 10 min antes
let mediaTokenRefresh = null;

function readStoredMediaToken() {
  try {
    const raw = localStorage.getItem(MEDIA_TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function refreshMediaToken() {
  if (mediaTokenRefresh) return mediaTokenRefresh;

  mediaTokenRefresh = api
    .get('/auth/media-token')
    .then((res) => {
      // El backend devuelve un TTL tipo "6h"; guardamos el instante de caducidad.
      const ttlMs = parseTtl(res.data?.expiresIn) || 6 * 60 * 60 * 1000;
      const entry = { token: res.data.token, expiresAt: Date.now() + ttlMs };
      localStorage.setItem(MEDIA_TOKEN_KEY, JSON.stringify(entry));
      return entry.token;
    })
    .catch(() => null)
    .finally(() => { mediaTokenRefresh = null; });

  return mediaTokenRefresh;
}

function parseTtl(value) {
  const m = /^(\d+)([smhd])$/.exec(String(value || ''));
  if (!m) return null;
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return Number(m[1]) * units[m[2]];
}

// Síncrona a propósito: la usan atributos src que se resuelven al renderizar.
// Si el token de media todavía no está listo cae al de sesión, así la
// reproducción nunca depende de que la renovación haya terminado.
function mediaToken() {
  const stored = readStoredMediaToken();
  if (stored && stored.expiresAt - Date.now() > MEDIA_TOKEN_REFRESH_MARGIN_MS) {
    return stored.token;
  }
  if (localStorage.getItem('ubeflix_token')) refreshMediaToken();
  return stored?.token || localStorage.getItem('ubeflix_token');
}

export function clearMediaToken() {
  localStorage.removeItem(MEDIA_TOKEN_KEY);
}

// Auth
export const login = (username, password) =>
  api.post('/auth/login', { username, password });

export const register = (username, email, password) =>
  api.post('/auth/register', { username, email, password });

export const getMe = () => api.get('/auth/me');

// Dashboard
export const getDashboard = () => api.get('/dashboard');

// Videos
export const getVideos = (params) => api.get('/videos', { params });
export const getVideo = (id) => api.get(`/videos/${id}`);
export const getRecentVideos = () => api.get('/videos/recent');
export const getVideoStreamUrl = (id) => {
  const token = mediaToken();
  return `${API_URL}/videos/${id}/stream?token=${token}`;
};

// Series
export const getSeries = (params) => api.get('/videos/series/list', { params });
export const getSeriesDetail = (id) => api.get(`/videos/series/${id}`);

// Progress
export const saveProgress = (videoId, data) =>
  api.post(`/videos/${videoId}/progress`, data);
export const getProgress = (videoId) =>
  api.get(`/videos/${videoId}/progress`);

// Libraries
export const getLibraries = () => api.get('/libraries');
export const createLibrary = (data) => api.post('/libraries', data);
export const updateLibrary = (id, data) => api.put(`/libraries/${id}`, data);
export const deleteLibrary = (id) => api.delete(`/libraries/${id}`);
export const scanLibrary = (id) => api.post(`/libraries/${id}/scan`);
export const browseDirectories = (dirPath) => api.get('/libraries/browse', { params: { path: dirPath } });

// Host remount agent: reconnect a disconnected Windows drive from the app.
export const getRemountConfig = () => api.get('/libraries/remount-config');
// Calls the agent DIRECTLY (different origin, runs on the host). Long timeout:
// the agent remounts, restarts the backend and waits for it to be healthy.
export const remountDrive = ({ url, token }, driveLetter) =>
  axios.post(
    `${url.replace(/\/$/, '')}/remount`,
    { drive: driveLetter },
    {
      headers: token ? { 'X-Remount-Token': token } : {},
      timeout: 90000,
    }
  );

// Favorites
export const getFavorites = () => api.get('/favorites');
export const toggleFavorite = (data) => api.post('/favorites', data);
export const checkFavorite = (params) => api.get('/favorites/check', { params });

// Users (admin)
export const getUsers = () => api.get('/users');
export const updateUser = (id, data) => api.put(`/users/${id}`, data);
export const deleteUser = (id) => api.delete(`/users/${id}`);

// Unified Search
export const searchAll = (q) => api.get('/search', { params: { q } });

// Next video
export const getNextVideo = (videoId) => api.get(`/videos/${videoId}/next`);

// Audio tracks
export const getAudioTracks = (videoId) => api.get(`/videos/${videoId}/audio-tracks`);

// Subtitles
export const getSubtitles = (videoId) => api.get(`/subtitles/${videoId}`);
export const batchCheckSubtitles = (videoIds) => api.post('/subtitles/batch-check', { videoIds });
export const extractSubtitles = (videoId) => api.post(`/subtitles/${videoId}/extract`);
export const extractLibrarySubtitles = (libraryId) => api.post(`/subtitles/library/${libraryId}/extract-all`);
export const autoOpenSubtitlesLibrary = (libraryId) => api.post(`/subtitles/library/${libraryId}/auto-opensubtitles`);
export const searchOpenSubtitles = (videoId, query) => api.post(`/subtitles/${videoId}/search`, { query });
export const downloadOpenSub = (videoId, fileId) => api.post(`/subtitles/${videoId}/download`, { file_id: fileId });
export const deleteSubtitle = (videoId, subId) => api.delete(`/subtitles/${videoId}/${subId}`);
export const uploadSubtitle = (videoId, file, label, language) => {
  const formData = new FormData();
  formData.append('subtitle', file);
  if (label) formData.append('label', label);
  if (language) formData.append('language', language);
  return api.post(`/subtitles/${videoId}/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
};
export const getSubtitleFileUrl = (videoId, subId) => {
  const token = mediaToken();
  return `${API_URL}/subtitles/${videoId}/file/${subId}?token=${encodeURIComponent(token)}`;
};

// Music / Spotify
export const getMusicPlaylists = () => api.get('/music/playlists');
export const getMusicPlaylistDetail = (id) => api.get(`/music/playlists/${id}`);
export const syncSpotifyPlaylist = (playlistUrl) => api.post('/music/sync', { playlist_url: playlistUrl });
export const resyncMusicPlaylist = (id) => api.post(`/music/playlists/${id}/resync`);
export const downloadMusicPlaylist = (id) => api.post(`/music/playlists/${id}/download`);
export const downloadMusicTrack = (id) => api.post(`/music/tracks/${id}/download`);
export const deleteMusicPlaylist = (id) => api.delete(`/music/playlists/${id}`);
export const updateMusicPlaylist = (id, data) => api.put(`/music/playlists/${id}`, data);
export const getMusicDownloadStatus = (playlistId) => api.get(`/music/download-status/${playlistId}`);
export const getMusicStreamUrl = (trackId) => {
  const token = mediaToken();
  return `${API_URL}/music/tracks/${trackId}/stream?token=${encodeURIComponent(token)}`;
};

// Torrents
export const searchTorrents = (q, sources) =>
  api.get('/torrents/search', { params: { q, sources: sources ? sources.join(',') : undefined } });
export const getTorrentDownloads = () => api.get('/torrents');
export const startTorrentDownload = (data) => api.post('/torrents/download', data);
export const pauseTorrentDownload = (id) => api.post(`/torrents/${id}/pause`);
export const resumeTorrentDownload = (id) => api.post(`/torrents/${id}/resume`);
export const removeTorrentDownload = (id, deleteFiles = false) =>
  api.delete(`/torrents/${id}`, { params: { deleteFiles } });
export const clearCompletedTorrents = () => api.post('/torrents/clear-completed');

// Thumbnails
export const generateThumbnail = (videoId) => api.post(`/subtitles/thumbnails/generate/${videoId}`);
export const generateLibraryThumbnails = (libraryId) => api.post(`/subtitles/thumbnails/library/${libraryId}`);
export const getThumbnailUrl = (videoId) => {
  const token = mediaToken();
  return `${API_URL}/subtitles/thumbnails/file/${videoId}?token=${encodeURIComponent(token)}`;
};
export const getSeriesThumbnailUrl = (seriesId) => {
  const token = mediaToken();
  return `${API_URL}/subtitles/thumbnails/series/${seriesId}?token=${encodeURIComponent(token)}`;
};

// Comics
export const getComics = (params) => api.get('/comics', { params });
export const getComic = (id) => api.get(`/comics/${id}`);
export const getComicInfo = (id) => api.get(`/comics/${id}/info`);
export const scanComicsLibrary = (libraryId) => api.post(`/comics/scan-library/${libraryId}`);
export const deleteComic = (id) => api.delete(`/comics/${id}`);
export const getComicPageUrl = (id, pageIndex) => {
  const token = mediaToken();
  return `${API_URL}/comics/${id}/page/${pageIndex}?token=${encodeURIComponent(token)}`;
};
export const getComicCoverUrl = (id) => {
  const token = mediaToken();
  return `${API_URL}/comics/${id}/cover?token=${encodeURIComponent(token)}`;
};
export const getComicFileUrl = (id) => {
  const token = mediaToken();
  return `${API_URL}/comics/${id}/file?token=${encodeURIComponent(token)}`;
};

export default api;

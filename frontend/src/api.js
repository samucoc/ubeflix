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
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

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
  const token = localStorage.getItem('ubeflix_token');
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
export const deleteLibrary = (id) => api.delete(`/libraries/${id}`);
export const scanLibrary = (id) => api.post(`/libraries/${id}/scan`);
export const browseDirectories = (dirPath) => api.get('/libraries/browse', { params: { path: dirPath } });

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
  const token = localStorage.getItem('ubeflix_token');
  return `${API_URL}/subtitles/${videoId}/file/${subId}?token=${encodeURIComponent(token)}`;
};

// Thumbnails
export const generateThumbnail = (videoId) => api.post(`/subtitles/thumbnails/generate/${videoId}`);
export const generateLibraryThumbnails = (libraryId) => api.post(`/subtitles/thumbnails/library/${libraryId}`);
export const getThumbnailUrl = (videoId) => {
  const token = localStorage.getItem('ubeflix_token');
  return `${API_URL}/subtitles/thumbnails/file/${videoId}?token=${encodeURIComponent(token)}`;
};
export const getSeriesThumbnailUrl = (seriesId) => {
  const token = localStorage.getItem('ubeflix_token');
  return `${API_URL}/subtitles/thumbnails/series/${seriesId}?token=${encodeURIComponent(token)}`;
};

export default api;

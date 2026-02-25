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

// Handle 401/403 responses
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
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

export default api;

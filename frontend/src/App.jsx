import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';

// Login y Dashboard son lo primero que se ve: van en el bundle inicial.
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';

// El resto se carga al navegar. Esto saca del arranque las dependencias
// pesadas: hls.js (player y TV en vivo) y el visor de PDF (lector de comics).
const MoviesPage = lazy(() => import('./pages/MoviesPage'));
const SeriesPage = lazy(() => import('./pages/SeriesPage'));
const SeriesDetailPage = lazy(() => import('./pages/SeriesDetailPage'));
const VideoDetailPage = lazy(() => import('./pages/VideoDetailPage'));
const PlayerPage = lazy(() => import('./pages/PlayerPage'));
const LibrariesPage = lazy(() => import('./pages/LibrariesPage'));
const FavoritesPage = lazy(() => import('./pages/FavoritesPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const LiveTVPage = lazy(() => import('./pages/LiveTVPage'));
const MusicPage = lazy(() => import('./pages/MusicPage'));
const ComicsPage = lazy(() => import('./pages/ComicsPage'));
const ComicReaderPage = lazy(() => import('./pages/ComicReaderPage'));

function PageFallback() {
  return (
    <div className="loading" style={{ height: '60vh' }}>
      <div className="spinner" />
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="loading" style={{ height: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }
  return user ? children : <Navigate to="/login" replace />;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading" style={{ height: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/player/:id" element={
        <ProtectedRoute><PlayerPage /></ProtectedRoute>
      } />
      <Route path="/comics/:id" element={
        <ProtectedRoute><ComicReaderPage /></ProtectedRoute>
      } />
      <Route path="/" element={
        <ProtectedRoute><Layout /></ProtectedRoute>
      }>
        <Route index element={<DashboardPage />} />
        <Route path="movies" element={<MoviesPage />} />
        <Route path="series" element={<SeriesPage />} />
        <Route path="series/:id" element={<SeriesDetailPage />} />
        <Route path="video/:id" element={<VideoDetailPage />} />
        <Route path="favorites" element={<FavoritesPage />} />
        <Route path="live" element={<LiveTVPage />} />
        <Route path="music" element={<MusicPage />} />
        <Route path="comics" element={<ComicsPage />} />
        <Route path="libraries" element={<LibrariesPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

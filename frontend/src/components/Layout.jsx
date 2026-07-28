import React, { useState, useEffect, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { searchAll } from '../api';
import ProgressToast from './ProgressToast';
import {
  Home, Film, Tv, FolderOpen, Search, LogOut, Play, Settings,
  Heart, Users, Menu, X, Radio, Music, BookOpen
} from 'lucide-react';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [showResults, setShowResults] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const searchRef = useRef(null);
  const searchTimeout = useRef(null);

  const navItems = [
    { path: '/', label: 'Inicio', icon: Home },
    { path: '/movies', label: 'Películas', icon: Film },
    { path: '/series', label: 'Series', icon: Tv },
    { path: '/favorites', label: 'Favoritos', icon: Heart },
    { path: '/live', label: 'TV en Vivo', icon: Radio },
    { path: '/music', label: 'Música', icon: Music },
    { path: '/comics', label: 'Comics', icon: BookOpen },
  ];

  const adminItems = [
    { path: '/libraries', label: 'Bibliotecas', icon: FolderOpen },
    { path: '/users', label: 'Usuarios', icon: Users },
    { path: '/settings', label: 'Configuración', icon: Settings },
  ];

  // Live search with debounce
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    if (!search.trim()) {
      setSearchResults(null);
      setShowResults(false);
      return;
    }

    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await searchAll(search.trim());
        setSearchResults(res.data);
        setShowResults(true);
      } catch (err) {
        console.error('Search error:', err);
      }
    }, 300);

    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [search]);

  // Close search results on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const handleSearch = (e) => {
    e.preventDefault();
    if (search.trim()) {
      setShowResults(false);
      navigate(`/movies?search=${encodeURIComponent(search.trim())}`);
    }
  };

  const handleResultClick = (type, id) => {
    setShowResults(false);
    setSearch('');
    if (type === 'series') {
      navigate(`/series/${id}`);
    } else {
      navigate(`/video/${id}`);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const totalResults = searchResults
    ? (searchResults.movies?.length || 0) + (searchResults.series?.length || 0)
    : 0;

  return (
    <div className="app-layout">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-logo">
          <div className="logo-icon">
            <Play size={20} />
          </div>
          <h1>ubeFlix</h1>
          <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)}>
            <X size={20} />
          </button>
        </div>

        <button className="sidebar-expand-btn" onClick={() => setSidebarOpen(true)} data-tooltip="Menú">
          <Menu size={20} />
        </button>

        <nav className="sidebar-nav">
          <div className="sidebar-section">Media</div>
          {navItems.map((item) => (
            <button
              key={item.path}
              className={`sidebar-item ${isActive(item.path) ? 'active' : ''}`}
              onClick={() => navigate(item.path)}
              data-tooltip={item.label}
            >
              <item.icon size={20} />
              <span className="sidebar-label">{item.label}</span>
            </button>
          ))}

          {user?.is_admin && (
            <>
              <div className="sidebar-section" style={{ marginTop: 16 }}>Administración</div>
              {adminItems.map((item) => (
                <button
                  key={item.path}
                  className={`sidebar-item ${isActive(item.path) ? 'active' : ''}`}
                  onClick={() => navigate(item.path)}
                  data-tooltip={item.label}
                >
                  <item.icon size={20} />
                  <span className="sidebar-label">{item.label}</span>
                </button>
              ))}
            </>
          )}
        </nav>

        <div className="sidebar-user">
          <div className="sidebar-user-avatar">
            {user?.username?.charAt(0).toUpperCase()}
          </div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user?.username}</div>
            <div className="sidebar-user-role">{user?.is_admin ? 'Admin' : 'Usuario'}</div>
          </div>
          <button className="btn-icon" onClick={handleLogout} title="Cerrar sesión">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="main-content">
        <header className="header">
          <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
            <Menu size={24} />
          </button>

          <form className="header-search" onSubmit={handleSearch} ref={searchRef}>
            <Search />
            <input
              type="text"
              placeholder="Buscar películas, series..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => search.trim() && searchResults && setShowResults(true)}
            />
            {/* Search results dropdown */}
            {showResults && searchResults && (
              <div className="search-dropdown">
                {totalResults === 0 ? (
                  <div className="search-dropdown-empty">No se encontraron resultados</div>
                ) : (
                  <>
                    {searchResults.movies?.length > 0 && (
                      <>
                        <div className="search-dropdown-section">Películas</div>
                        {searchResults.movies.map((movie) => (
                          <div
                            key={`m-${movie.id}`}
                            className="search-dropdown-item"
                            onClick={() => handleResultClick('movie', movie.id)}
                          >
                            <Film size={16} />
                            <span>{movie.title}</span>
                            {movie.year && <span className="search-dropdown-year">{movie.year}</span>}
                          </div>
                        ))}
                      </>
                    )}
                    {searchResults.series?.length > 0 && (
                      <>
                        <div className="search-dropdown-section">Series</div>
                        {searchResults.series.map((s) => (
                          <div
                            key={`s-${s.id}`}
                            className="search-dropdown-item"
                            onClick={() => handleResultClick('series', s.id)}
                          >
                            <Tv size={16} />
                            <span>{s.title}</span>
                            {s.year && <span className="search-dropdown-year">{s.year}</span>}
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </form>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>

      <ProgressToast />
    </div>
  );
}

import React, { createContext, useContext, useState, useEffect } from 'react';
import { login as apiLogin, register as apiRegister, getMe, refreshMediaToken, clearMediaToken } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('ubeflix_token');
    if (token) {
      getMe()
        .then((res) => setUser(res.data))
        .catch(() => {
          localStorage.removeItem('ubeflix_token');
          localStorage.removeItem('ubeflix_user');
          clearMediaToken();
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username, password) => {
    const res = await apiLogin(username, password);
    const { user: userData, token } = res.data;
    localStorage.setItem('ubeflix_token', token);
    localStorage.setItem('ubeflix_user', JSON.stringify(userData));
    clearMediaToken();
    refreshMediaToken();
    setUser(userData);
    return userData;
  };

  const registerUser = async (username, email, password) => {
    const res = await apiRegister(username, email, password);
    const { user: userData, token } = res.data;
    localStorage.setItem('ubeflix_token', token);
    localStorage.setItem('ubeflix_user', JSON.stringify(userData));
    clearMediaToken();
    refreshMediaToken();
    setUser(userData);
    return userData;
  };

  const logout = () => {
    localStorage.removeItem('ubeflix_token');
    localStorage.removeItem('ubeflix_user');
    clearMediaToken();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register: registerUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

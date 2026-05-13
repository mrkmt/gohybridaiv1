import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface User {
  id: string;
  email?: string;
  display_name?: string;
  role: string;
  is_active: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const AuthContext = createContext<AuthContextType | null>(null);

/**
 * Validate a stored JWT before trusting it. Rejects malformed or expired
 * tokens so stale values in localStorage don't pin the app into an
 * authenticated state it can't recover from.
 */
function isTokenValid(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1]));
    if (typeof payload.exp !== 'number') return true;
    return payload.exp > Date.now() / 1000;
  } catch { return false; }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem('auth_token');
    const storedUser = localStorage.getItem('auth_user');
    if (stored && storedUser && isTokenValid(stored)) {
      setToken(stored);
      try { setUser(JSON.parse(storedUser)); } catch { logout(); }
    } else if (stored || storedUser) {
      // Stale or malformed — clear so we fall through to /login.
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
    }
  }, [logout]);

  // React to AUTH_EXPIRED events dispatched by useApi / useExecutionWebSocket.
  useEffect(() => {
    const onExpired = () => logout();
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [logout]);

  const login = useCallback(async (identifier: string, password: string) => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Login failed');
    }

    const data = await res.json();
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('auth_token', data.token);
    localStorage.setItem('auth_user', JSON.stringify(data.user));
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, token, login, logout, isAuthenticated: !!token }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

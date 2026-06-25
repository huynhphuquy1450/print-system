import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import api, { setAuthToken, setUnauthorizedHandler } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => sessionStorage.getItem('hq_token'));
  const [client, setClient] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem('hq_client'));
    } catch {
      return null;
    }
  });

  // Đồng bộ token vào client.js mỗi khi đổi
  useEffect(() => {
    setAuthToken(token);
  }, [token]);

  // Đăng ký handler 401 một lần
  useEffect(() => {
    setUnauthorizedHandler(logout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveToken(t) {
    setToken(t);
    if (t) sessionStorage.setItem('hq_token', t);
    else sessionStorage.removeItem('hq_token');
    setAuthToken(t);
  }

  function saveClient(c) {
    setClient(c);
    if (c) sessionStorage.setItem('hq_client', JSON.stringify(c));
    else sessionStorage.removeItem('hq_client');
  }

  async function login(client_id, client_secret) {
    const data = await api.login(client_id, client_secret);
    saveToken(data.token);
    const info = await api.me();
    saveClient(info);
    return info;
  }

  function logout() {
    saveToken(null);
    saveClient(null);
  }

  const isAuthed = Boolean(token);

  return (
    <AuthContext.Provider value={{ token, client, login, logout, isAuthed }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

/** Bảo vệ route — redirect về /login nếu chưa đăng nhập */
export function ProtectedRoute({ children }) {
  const { isAuthed } = useAuth();
  if (!isAuthed) return <Navigate to="/login" replace />;
  return children ?? <Outlet />;
}

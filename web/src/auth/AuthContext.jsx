import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import api, { setAuthToken, setUnauthorizedHandler } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => {
    const t = localStorage.getItem('hq_token');
    // Đồng bộ NGAY khi khởi tạo — effect của page con chạy TRƯỚC effect của Provider,
    // nếu chỉ sync trong useEffect thì fetch đầu tiên sau F5 thiếu Authorization → 401 → bị logout oan
    setAuthToken(t);
    return t;
  });
  const [client, setClient] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('hq_client'));
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
    if (t) localStorage.setItem('hq_token', t);
    else localStorage.removeItem('hq_token');
    setAuthToken(t);
  }

  function saveClient(c) {
    setClient(c);
    if (c) localStorage.setItem('hq_client', JSON.stringify(c));
    else localStorage.removeItem('hq_client');
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

import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import Field from '../components/Field.jsx';
import Spinner from '../components/Spinner.jsx';
import styles from './LoginPage.module.css';

export default function LoginPage() {
  const { isAuthed, login } = useAuth();
  const navigate = useNavigate();

  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [loading, setLoading] = useState(false);
  // Lỗi hiển thị inline bên dưới form, không dùng toast
  const [error, setError] = useState('');

  // Đã đăng nhập → chuyển thẳng sang trang dashboard
  if (isAuthed) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(clientId, clientSecret);
      navigate('/dashboard');
    } catch (err) {
      // Phân loại lỗi theo HTTP status
      if (err.status === 401) {
        setError('Sai client_id hoặc client_secret');
      } else if (err.status === 429) {
        setError('Quá nhiều lần thử, đợi 1 phút');
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={`card ${styles.card}`}>
        <div className={styles.logo} aria-hidden="true">
          <Printer size={28} strokeWidth={2} />
        </div>
        <h1 className={styles.title}>HQ Print Admin</h1>
        <p className={styles.subtitle}>Đăng nhập để tiếp tục</p>
        <form onSubmit={handleSubmit} noValidate className={styles.form}>
          <Field label="Client ID" htmlFor="client_id" required>
            <input
              id="client_id"
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              autoComplete="username"
              required
            />
          </Field>
          <Field label="Client Secret" htmlFor="client_secret" required>
            <input
              id="client_secret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          {/* Banner lỗi inline bên dưới các field */}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            className={`btn btn-accent ${styles.submit}`}
            disabled={loading}
          >
            {loading && <Spinner size="sm" />}
            {loading ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>
        </form>
      </div>
    </div>
  );
}

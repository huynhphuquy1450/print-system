import { LogOut } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import styles from './Topbar.module.css';

export default function Topbar() {
  const { client, logout } = useAuth();
  const displayName = client?.name || client?.id || '—';

  return (
    <header className={styles.topbar}>
      <span className={styles.identity}>{displayName}</span>
      <button className={`btn btn-ghost ${styles.logoutBtn}`} onClick={logout}>
        <LogOut size={14} />
        Đăng xuất
      </button>
    </header>
  );
}

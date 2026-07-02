import { LogOut, Menu } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import styles from './Topbar.module.css';

export default function Topbar({ sidebarOpen, onMenuClick }) {
  const { client, logout } = useAuth();
  const displayName = client?.name || client?.id || '—';

  return (
    <header className={styles.topbar}>
      <button
        type="button"
        className={styles.menuBtn}
        aria-label="Mở menu"
        aria-expanded={sidebarOpen}
        onClick={onMenuClick}
      >
        <Menu size={20} />
      </button>
      <div className={styles.right}>
        <span className={styles.identity}>{displayName}</span>
        <button
          className={`btn btn-ghost ${styles.logoutBtn}`}
          onClick={logout}
          aria-label="Đăng xuất"
        >
          <LogOut size={14} />
          Đăng xuất
        </button>
      </div>
    </header>
  );
}

import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import styles from './Layout.module.css';

export default function Layout() {
  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.main}>
        <Topbar />
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

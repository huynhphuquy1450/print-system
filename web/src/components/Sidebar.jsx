import { NavLink } from 'react-router-dom';
import { AlertTriangle, MonitorCheck, Printer, ScrollText, Upload, Webhook } from 'lucide-react';
import styles from './Sidebar.module.css';

const NAV = [
  { to: '/jobs',     label: 'Print Jobs', icon: Printer },
  { to: '/stations', label: 'Trạm in',   icon: MonitorCheck },
  { to: '/printers', label: 'Máy in',    icon: Printer },
  { to: '/upload',   label: 'Upload',     icon: Upload },
  { to: '/audit',    label: 'Audit Log',  icon: ScrollText },
  { to: '/webhooks', label: 'Webhooks',   icon: Webhook },
  { to: '/alerts',   label: 'Cảnh báo',  icon: AlertTriangle },
];

export default function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <Printer size={20} />
        <span>HQ Print Admin</span>
      </div>
      <nav className={styles.nav}>
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `${styles.link} ${isActive ? styles.active : ''}`
            }
          >
            <Icon size={16} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

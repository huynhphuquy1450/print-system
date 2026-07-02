import { NavLink } from 'react-router-dom';
import {
  AlertTriangle,
  Building2,
  LayoutDashboard,
  MonitorCheck,
  Printer,
  ScrollText,
  Upload,
  Webhook,
} from 'lucide-react';
import styles from './Sidebar.module.css';

const NAV = [
  { to: '/dashboard', label: 'Tổng quan',  icon: LayoutDashboard },
  { to: '/clients',  label: 'Clients',    icon: Building2 },
  { to: '/jobs',     label: 'Print Jobs', icon: Printer },
  { to: '/stations', label: 'Trạm in',   icon: MonitorCheck },
  { to: '/printers', label: 'Máy in',    icon: Printer },
  { to: '/upload',   label: 'Upload',     icon: Upload },
  { to: '/audit',    label: 'Audit Log',  icon: ScrollText },
  { to: '/webhooks', label: 'Webhooks',   icon: Webhook },
  { to: '/alerts',   label: 'Cảnh báo',  icon: AlertTriangle },
];

export default function Sidebar({ open, onNavigate }) {
  return (
    <aside className={`${styles.sidebar} ${open ? styles.open : ''}`}>
      <div className={styles.logo}>
        <Printer size={20} />
        <span>HQ Print Admin</span>
      </div>
      <nav className={styles.nav}>
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
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

import styles from './EmptyState.module.css';

/**
 * @param {{ icon?:React.ReactNode, title:string, message?:string, action?:React.ReactNode }} props
 */
export default function EmptyState({ icon, title, message, action }) {
  return (
    <div className={styles.wrap}>
      {icon && <span className={styles.icon}>{icon}</span>}
      <p className={styles.title}>{title}</p>
      {message && <p className={styles.message}>{message}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}

import styles from './Spinner.module.css';

/** @param {{ size?: 'sm' | 'md' }} props */
export default function Spinner({ size = 'md' }) {
  return (
    <span
      className={`${styles.spinner} ${styles[size] || styles.md}`}
      role="status"
      aria-label="Đang tải"
    />
  );
}

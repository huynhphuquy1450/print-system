import styles from './Spinner.module.css';

/** @param {{ size?: number }} props */
export default function Spinner({ size = 20 }) {
  return (
    <span
      className={styles.spinner}
      style={{ width: size, height: size }}
      role="status"
      aria-label="Đang tải"
    />
  );
}

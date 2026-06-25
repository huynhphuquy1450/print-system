import styles from './FilterBar.module.css';

/**
 * @param {{ onSubmit:()=>void, onReset:()=>void, children:React.ReactNode }} props
 */
export default function FilterBar({ onSubmit, onReset, children }) {
  function handleSubmit(e) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <form className={styles.bar} onSubmit={handleSubmit}>
      <div className={styles.fields}>{children}</div>
      <div className={styles.actions}>
        <button type="submit" className="btn btn-primary">Lọc</button>
        <button type="button" className="btn btn-ghost" onClick={onReset}>Xóa lọc</button>
      </div>
    </form>
  );
}

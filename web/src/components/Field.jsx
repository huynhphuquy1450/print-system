import styles from './Field.module.css';

/**
 * @param {{ label:string, htmlFor?:string, error?:string, required?:boolean, hint?:string, children:React.ReactNode }} props
 */
export default function Field({ label, htmlFor, error, required, hint, children }) {
  return (
    <div className={styles.field}>
      <label htmlFor={htmlFor} className={styles.label}>
        {label}
        {required && <span className={styles.req} aria-hidden="true"> *</span>}
      </label>
      {children}
      {hint && !error && <span className={styles.hint}>{hint}</span>}
      {error && <span className={styles.error} role="alert">{error}</span>}
    </div>
  );
}

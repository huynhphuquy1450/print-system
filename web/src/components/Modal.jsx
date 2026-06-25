import { useEffect } from 'react';
import { X } from 'lucide-react';
import styles from './Modal.module.css';

/**
 * @param {{ open:boolean, title:string, onClose:()=>void, children:React.ReactNode, footer?:React.ReactNode }} props
 */
export default function Modal({ open, title, onClose, children, footer }) {
  // Đóng bằng Esc
  useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={styles.overlay}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      aria-modal="true"
      role="dialog"
      aria-label={title}
    >
      <div className={styles.dialog}>
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Đóng">
            <X size={16} />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  );
}

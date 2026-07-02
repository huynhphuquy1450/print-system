import { useEffect } from 'react';
import { X } from 'lucide-react';
import styles from './Modal.module.css';

/**
 * @param {{ open:boolean, title:string, onClose:()=>void, children:React.ReactNode, footer?:React.ReactNode, closeDisabled?:boolean }} props
 */
export default function Modal({ open, title, onClose, children, footer, closeDisabled = false }) {
  // Đóng bằng Esc
  useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      if (e.key === 'Escape' && !closeDisabled) onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose, closeDisabled]);

  if (!open) return null;

  return (
    <div
      className={styles.overlay}
      onClick={(e) => { if (closeDisabled) return; if (e.target === e.currentTarget) onClose(); }}
      aria-modal="true"
      role="dialog"
      aria-label={title}
    >
      <div className={styles.dialog}>
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button
            className={styles.closeBtn}
            onClick={() => { if (!closeDisabled) onClose(); }}
            aria-label="Đóng"
            disabled={closeDisabled}
          >
            <X size={16} />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  );
}

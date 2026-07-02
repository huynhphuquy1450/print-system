import { AlertTriangle } from 'lucide-react';
import styles from './ErrorState.module.css';

/**
 * Khối báo lỗi gọn, dùng khi tải danh sách/dữ liệu thất bại — đặt bên trong
 * .card hoặc khu vực bảng, không chiếm toàn trang (khác với ErrorBoundary).
 * @param {{ message?: string, onRetry?: () => void }} props
 */
export default function ErrorState({ message = 'Không tải được dữ liệu', onRetry }) {
  return (
    <div className={styles.wrap}>
      <span className={styles.icon}>
        <AlertTriangle size={28} />
      </span>
      <p className={styles.message}>{message}</p>
      {onRetry && (
        <div className={styles.action}>
          <button className="btn btn-ghost btn-sm" onClick={onRetry}>
            Thử lại
          </button>
        </div>
      )}
    </div>
  );
}

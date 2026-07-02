import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';
import styles from './Page.module.css';

/**
 * Error boundary React — bọc quanh <App /> hoặc một nhánh route để chặn lỗi
 * render, tránh sập trắng toàn bộ ứng dụng. Khi con bên trong throw lỗi lúc
 * render, hiển thị UI dự phòng thay vì cây component bị lỗi.
 *
 * Cách dùng: <ErrorBoundary><App /></ErrorBoundary>
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className={styles.errorBoundary}>
          <div className={`card ${styles.errorBoundaryCard}`}>
            <span className={styles.errorIcon}>
              <AlertTriangle size={40} />
            </span>
            <h2 className={styles.errorTitle}>Đã xảy ra lỗi</h2>
            <p className={styles.errorDetail}>
              {this.state.error?.message || 'Vui lòng tải lại trang hoặc liên hệ quản trị viên.'}
            </p>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Tải lại trang
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { listJobs, listAlerts } from '../api/client.js';
import { getBranches, invalidateBranches } from '../api/branchesCache.js';
import { isOnline, useFreshMs } from '../lib/presence.js';
import { usePolling } from '../hooks/usePolling.js';
import DataTable from '../components/DataTable.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import Spinner from '../components/Spinner.jsx';
import pageStyles from '../components/Page.module.css';
import styles from './DashboardPage.module.css';

// Nhãn tiếng Việt cho loại cảnh báo — copy từ AlertsPage.jsx để giữ nhất quán
const ALERT_LABELS = {
  'branch.offline': 'Chi nhánh mất kết nối',
  'branch.online': 'Chi nhánh phục hồi',
  'printer.offline': 'Máy in mất kết nối',
  'printer.online': 'Máy in phục hồi',
  'printer.out_of_paper': 'Hết giấy',
  'printer.paper_jam': 'Kẹt giấy',
  'printer.low_toner': 'Sắp hết mực',
  'printer.no_toner': 'Hết mực',
};

const RECENT_ALERTS_LIMIT = 8;
const POLL_INTERVAL_MS = 30000;

const EMPTY_DATA = {
  jobsToday: 0,
  jobsFailedToday: 0,
  branches: [],
  alertsTotal: 0,
  recentAlerts: [],
};

export default function DashboardPage() {
  const freshMs = useFreshMs();

  const [data, setData] = useState(EMPTY_DATA);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  const fetchAll = useCallback(async () => {
    try {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const from24h = Date.now() - 24 * 60 * 60 * 1000;

      // Xóa cache trước mỗi tick để last_seen_at tươi — KPI "Trạm online" phụ thuộc nó
      invalidateBranches();
      const [jobsToday, jobsFailedToday, branches, alerts24h] = await Promise.all([
        listJobs({ from: startOfToday.getTime(), limit: 1 }),
        listJobs({ from: startOfToday.getTime(), status: 'failed', limit: 1 }),
        getBranches(),
        // Server sắp xếp mới nhất trước — tái dùng luôn cho bảng "gần nhất"
        listAlerts({ from: from24h, limit: RECENT_ALERTS_LIMIT }),
      ]);

      setData({
        jobsToday: jobsToday.total || 0,
        jobsFailedToday: jobsFailedToday.total || 0,
        branches: branches || [],
        alertsTotal: alerts24h.total || 0,
        recentAlerts: alerts24h.alerts || [],
      });
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  usePolling(fetchAll, POLL_INTERVAL_MS);

  const branchMap = useMemo(
    () => Object.fromEntries(data.branches.map((b) => [String(b.id), b.name])),
    [data.branches]
  );
  const onlineCount = useMemo(
    () => data.branches.filter((b) => isOnline(b.last_seen_at, freshMs)).length,
    [data.branches, freshMs]
  );
  const totalBranches = data.branches.length;

  const alertColumns = [
    {
      key: 'created_at',
      header: 'Thời gian',
      render: (val) => new Date(val).toLocaleString('vi-VN'),
    },
    {
      key: 'branch_id',
      header: 'Chi nhánh',
      render: (val) => branchMap[String(val)] || val || '—',
    },
    {
      key: 'printer_id',
      header: 'Máy in',
      render: (val) => val || '—',
    },
    {
      key: 'alert_type',
      header: 'Loại cảnh báo',
      render: (val) => ALERT_LABELS[val] || val,
    },
    {
      key: 'status',
      header: 'Trạng thái',
      render: (val) => <StatusBadge status={val} />,
    },
  ];

  return (
    <div className={pageStyles.page}>
      <div className={pageStyles.header}>
        <h1 className={pageStyles.title}>Tổng quan</h1>
      </div>

      {!loaded ? (
        <div className={pageStyles.spinnerWrap}>
          <Spinner />
        </div>
      ) : error ? (
        <div className="card">
          <ErrorState message={error} onRetry={fetchAll} />
        </div>
      ) : (
        <>
          <div className={pageStyles.kpiGrid}>
            <div className={pageStyles.kpiCard}>
              <span className={pageStyles.kpiValue}>{data.jobsToday}</span>
              <span className={pageStyles.kpiLabel}>Jobs hôm nay</span>
            </div>

            <div
              className={[pageStyles.kpiCard, data.jobsFailedToday > 0 ? pageStyles.kpiDanger : '']
                .filter(Boolean)
                .join(' ')}
            >
              <span className={pageStyles.kpiValue}>{data.jobsFailedToday}</span>
              <span className={pageStyles.kpiLabel}>Jobs lỗi hôm nay</span>
            </div>

            <div
              className={[
                pageStyles.kpiCard,
                onlineCount === totalBranches ? pageStyles.kpiOk : pageStyles.kpiWarn,
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className={pageStyles.kpiValue}>
                {onlineCount}/{totalBranches}
              </span>
              <span className={pageStyles.kpiLabel}>Trạm online</span>
            </div>

            <div
              className={[pageStyles.kpiCard, data.alertsTotal > 0 ? pageStyles.kpiWarn : '']
                .filter(Boolean)
                .join(' ')}
            >
              <span className={pageStyles.kpiValue}>{data.alertsTotal}</span>
              <span className={pageStyles.kpiLabel}>Cảnh báo 24h</span>
            </div>
          </div>

          <div className="card">
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Cảnh báo gần nhất</h2>
              <Link to="/alerts" className="btn btn-ghost btn-sm">
                Xem tất cả
                <ArrowRight size={14} />
              </Link>
            </div>

            <DataTable
              columns={alertColumns}
              rows={data.recentAlerts}
              rowKey="id"
              empty={<EmptyState title="Không có cảnh báo" />}
            />
          </div>
        </>
      )}
    </div>
  );
}

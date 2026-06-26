import { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { listBranches, listPrinters } from '../api/client.js';
import { useToast } from '../ui/ToastContext.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import Spinner from '../components/Spinner.jsx';
import styles from './StationsPage.module.css';

const FRESH_MS = 60_000;

function isOnline(last_seen_at) {
  return last_seen_at != null && Date.now() - last_seen_at < FRESH_MS;
}

function relativeTime(last_seen_at) {
  if (last_seen_at == null) return 'chưa kết nối';
  const diffSec = Math.floor((Date.now() - last_seen_at) / 1000);
  if (diffSec < 60) return `${diffSec} giây trước`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  return `${Math.floor(diffMin / 60)} giờ trước`;
}

function effectivePrinterStatus(printer) {
  if (printer.last_seen_at == null) return 'unknown';
  if (!isOnline(printer.last_seen_at)) return 'offline';
  return printer.status;
}

export default function StationsPage() {
  const { toast } = useToast();
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const { branches: list } = await listBranches();
      const result = await Promise.all(
        (list || []).map(async (branch) => {
          try {
            const { printers } = await listPrinters(branch.id);
            return { ...branch, printers: printers || [] };
          } catch {
            return { ...branch, printers: [] };
          }
        })
      );
      setStations(result);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 12000);
    return () => clearInterval(id);
  }, [fetchAll]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Trạm in</h1>
        <button className="btn btn-primary" onClick={fetchAll} disabled={loading}>
          <RefreshCw size={14} />
          Làm mới
        </button>
      </div>

      {loading && stations.length === 0 && (
        <div className={styles.spinnerWrap}>
          <Spinner />
        </div>
      )}

      {!loading && stations.length === 0 && (
        <EmptyState title="Không có chi nhánh nào" message="Chưa có dữ liệu chi nhánh từ hệ thống" />
      )}

      <div className={styles.grid}>
        {stations.map((branch) => (
          <div key={branch.id} className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>
                <span className={styles.branchName}>{branch.name}</span>
                <StatusBadge status={isOnline(branch.last_seen_at) ? 'online' : 'offline'} />
              </div>
              {branch.location && (
                <span className={styles.cardLocation}>{branch.location}</span>
              )}
              <span className={styles.cardLastSeen}>
                Last seen: {relativeTime(branch.last_seen_at)}
              </span>
            </div>

            <div className={styles.printerList}>
              {(() => {
                const approvedPrinters = branch.printers.filter((p) => p.approved !== 0);
                return approvedPrinters.length === 0 ? (
                  <EmptyState title="Chưa có máy in" />
                ) : (
                  approvedPrinters.map((printer) => (
                    <div key={printer.id} className={styles.printerRow}>
                      <span className={styles.printerName}>{printer.name}</span>
                      <StatusBadge status={effectivePrinterStatus(printer)} />
                    </div>
                  ))
                );
              })()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

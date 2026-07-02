import { useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { listBranches, listPrinters, updateBranch } from '../api/client.js';
import { useToast } from '../ui/ToastContext.jsx';
import { isOnline, relativeTime, effectivePrinterStatus, useFreshMs } from '../lib/presence.js';
import { usePolling } from '../hooks/usePolling.js';
import StatusBadge from '../components/StatusBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import Spinner from '../components/Spinner.jsx';
import Modal from '../components/Modal.jsx';
import Field from '../components/Field.jsx';
import styles from './StationsPage.module.css';

export default function StationsPage() {
  const { toast } = useToast();
  const freshMs = useFreshMs();
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // State cho modal đổi tên trạm
  const [editBranch, setEditBranch] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', location: '' });
  const [editErrors, setEditErrors] = useState({});
  const [editLoading, setEditLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
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
      setError(err.message);
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Poll mỗi 12 giây để cập nhật last_seen_at / trạng thái máy in
  usePolling(fetchAll, 12000);

  function handleOpenEdit(branch) {
    setEditBranch(branch);
    setEditForm({ name: branch.name, location: branch.location || '' });
    setEditErrors({});
  }

  async function handleEditSubmit(e) {
    e.preventDefault();
    const name = editForm.name.trim();
    if (!name) {
      setEditErrors({ name: 'Tên trạm không được để trống' });
      return;
    }
    if (name.length > 100) {
      setEditErrors({ name: 'Tên trạm không được quá 100 ký tự' });
      return;
    }
    setEditLoading(true);
    try {
      await updateBranch(editBranch.id, { name, location: editForm.location.trim() });
      setEditBranch(null);
      toast('Đã đổi tên trạm', 'success');
      fetchAll();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setEditLoading(false);
    }
  }

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
          <Spinner size="md" />
        </div>
      )}

      {error && !loading && stations.length === 0 && (
        <ErrorState message={error} onRetry={fetchAll} />
      )}

      {!loading && !error && stations.length === 0 && (
        <EmptyState title="Không có chi nhánh nào" message="Chưa có dữ liệu chi nhánh từ hệ thống" />
      )}

      <div className={styles.grid}>
        {stations.map((branch) => (
          <div key={branch.id} className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>
                <span className={styles.branchName}>{branch.name}</span>
                <StatusBadge status={isOnline(branch.last_seen_at, freshMs) ? 'online' : 'offline'} />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleOpenEdit(branch)}
                >
                  Đổi tên
                </button>
              </div>
              {branch.location && (
                <span className={styles.cardLocation}>{branch.location}</span>
              )}
              <span className={styles.cardLastSeen}>
                Lần cuối online: {relativeTime(branch.last_seen_at)}
              </span>
            </div>

            <div className={styles.printerList}>
              {(() => {
                const approvedPrinters = branch.printers.filter((p) => p.approved !== 0);
                return approvedPrinters.length === 0 ? (
                  <span className={styles.printerEmpty}>Chưa có máy in</span>
                ) : (
                  approvedPrinters.map((printer) => (
                    <div key={printer.id} className={styles.printerRow}>
                      <span className={styles.printerName}>{printer.name}</span>
                      <StatusBadge status={effectivePrinterStatus(printer, freshMs)} />
                    </div>
                  ))
                );
              })()}
            </div>
          </div>
        ))}
      </div>

      {/* Modal đổi tên trạm */}
      <Modal
        open={editBranch !== null}
        title="Đổi tên trạm"
        onClose={() => { if (!editLoading) setEditBranch(null); }}
        footer={
          <>
            <button
              className="btn btn-ghost"
              onClick={() => setEditBranch(null)}
              disabled={editLoading}
            >
              Hủy
            </button>
            <button
              className="btn btn-primary"
              disabled={editLoading}
              onClick={handleEditSubmit}
            >
              {editLoading ? 'Đang lưu…' : 'Lưu'}
            </button>
          </>
        }
      >
        <form onSubmit={handleEditSubmit} noValidate>
          <Field
            label="Tên trạm"
            htmlFor="edit-branch-name"
            required
            error={editErrors.name}
          >
            <input
              id="edit-branch-name"
              type="text"
              className="input"
              value={editForm.name}
              onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
            />
          </Field>
          <Field
            label="Vị trí"
            htmlFor="edit-branch-location"
            error={editErrors.location}
          >
            <input
              id="edit-branch-location"
              type="text"
              className="input"
              value={editForm.location}
              onChange={(e) => setEditForm((prev) => ({ ...prev, location: e.target.value }))}
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}

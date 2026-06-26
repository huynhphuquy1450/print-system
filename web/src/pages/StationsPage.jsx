import { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { listBranches, listPrinters, updateBranch, getConfig } from '../api/client.js';
import { useToast } from '../ui/ToastContext.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import Spinner from '../components/Spinner.jsx';
import Modal from '../components/Modal.jsx';
import Field from '../components/Field.jsx';
import styles from './StationsPage.module.css';

// Fallback nếu fetch /api/v1/config lỗi (server là nguồn sự thật cho ngưỡng tươi — TASK 8).
const DEFAULT_FRESH_MS = 60_000;

function isOnline(last_seen_at, freshMs) {
  return last_seen_at != null && Date.now() - last_seen_at < freshMs;
}

function relativeTime(last_seen_at) {
  if (last_seen_at == null) return 'chưa kết nối';
  const diffSec = Math.floor((Date.now() - last_seen_at) / 1000);
  if (diffSec < 60) return `${diffSec} giây trước`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  return `${Math.floor(diffMin / 60)} giờ trước`;
}

function effectivePrinterStatus(printer, freshMs) {
  if (printer.last_seen_at == null) return 'unknown';
  if (!isOnline(printer.last_seen_at, freshMs)) return 'offline';
  return printer.status;
}

export default function StationsPage() {
  const { toast } = useToast();
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [freshMs, setFreshMs] = useState(DEFAULT_FRESH_MS);

  // State cho modal đổi tên trạm
  const [editBranch, setEditBranch] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', location: '' });
  const [editErrors, setEditErrors] = useState({});
  const [editLoading, setEditLoading] = useState(false);

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

  // Lấy ngưỡng tươi từ server (1 nguồn sự thật); giữ default nếu lỗi.
  useEffect(() => {
    getConfig()
      .then((cfg) => setFreshMs(cfg?.presence?.freshMs ?? DEFAULT_FRESH_MS))
      .catch(() => {});
  }, []);

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
                <StatusBadge status={isOnline(branch.last_seen_at, freshMs) ? 'online' : 'offline'} />
                <button
                  className="btn btn-ghost"
                  onClick={() => handleOpenEdit(branch)}
                >
                  Đổi tên
                </button>
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

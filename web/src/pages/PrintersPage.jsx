import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Plus, CheckCircle2 } from 'lucide-react';
import { listPrinters, createPrinter, updatePrinter, deletePrinter } from '../api/client.js';
import { getBranches } from '../api/branchesCache.js';
import { effectivePrinterStatus, useFreshMs } from '../lib/presence.js';
import { useToast } from '../ui/ToastContext.jsx';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import Field from '../components/Field.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import Spinner from '../components/Spinner.jsx';
import page from '../components/Page.module.css';
import styles from './PrintersPage.module.css';

const EMPTY_FORM = { branch_id: '', name: '', is_default: false };

export default function PrintersPage() {
  const { toast } = useToast();
  const freshMs = useFreshMs();

  const [rows, setRows] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Xác nhận xóa / từ chối
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Modal thêm máy in
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [createLoading, setCreateLoading] = useState(false);
  const [createErrors, setCreateErrors] = useState({});

  // Tải toàn bộ: branches (từ cache dùng chung) → printers theo từng branch
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const branchList = await getBranches();
      setBranches(branchList);
      const results = await Promise.all(
        branchList.map(async (branch) => {
          try {
            const { printers } = await listPrinters(branch.id);
            return (printers || []).map((p) => ({ ...p, branchName: branch.name }));
          } catch {
            return [];
          }
        })
      );
      setRows(results.flat());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Duyệt máy in
  async function handleApprove(id) {
    try {
      await updatePrinter(id, { approved: 1 });
      toast('Đã duyệt máy in', 'success');
      fetchAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // Đặt mặc định
  async function handleSetDefault(id) {
    try {
      await updatePrinter(id, { is_default: 1 });
      toast('Đã đặt làm mặc định', 'success');
      fetchAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // Xác nhận xóa / từ chối
  async function handleConfirmDelete() {
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    try {
      await deletePrinter(id);
      toast('Đã xóa máy in', 'success');
      fetchAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // Submit form thêm máy in
  async function handleCreateSubmit(e) {
    e.preventDefault();
    const errors = {};
    if (!createForm.branch_id) errors.branch_id = 'Vui lòng chọn chi nhánh';
    if (!createForm.name.trim()) errors.name = 'Tên máy in không được để trống';
    if (Object.keys(errors).length > 0) {
      setCreateErrors(errors);
      return;
    }
    setCreateErrors({});
    setCreateLoading(true);
    try {
      await createPrinter({
        branch_id: createForm.branch_id,
        name: createForm.name.trim(),
        ...(createForm.is_default ? { is_default: 1 } : {}),
      });
      setCreateForm(EMPTY_FORM);
      setCreateOpen(false);
      toast('Đã thêm máy in', 'success');
      fetchAll();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setCreateLoading(false);
    }
  }

  function handleCloseCreate() {
    setCreateOpen(false);
    setCreateForm(EMPTY_FORM);
    setCreateErrors({});
  }

  // Tìm row đang chờ xác nhận xóa (để hiển thị label đúng)
  const confirmRow = rows.find((r) => r.id === confirmDeleteId);

  const columns = [
    { key: 'name', header: 'Tên máy in' },
    { key: 'branchName', header: 'Chi nhánh' },
    {
      key: 'status',
      header: 'Trạng thái',
      render: (_val, row) => <StatusBadge status={effectivePrinterStatus(row, freshMs)} />,
    },
    {
      key: 'source',
      header: 'Nguồn',
      render: (val) => (val === 'manual' ? 'Tạo tay' : 'Tự phát hiện'),
    },
    {
      key: 'approved',
      header: 'Duyệt',
      render: (val) =>
        val == 0 ? (
          <span className={styles.inlineLabel}>
            <StatusBadge status="pending" />
            Chờ duyệt
          </span>
        ) : (
          'Đã duyệt'
        ),
    },
    {
      key: 'is_default',
      header: 'Mặc định',
      render: (val) =>
        val ? (
          <span className={styles.inlineLabel}>
            <CheckCircle2 size={14} className={styles.defaultIcon} aria-hidden="true" />
            Mặc định
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: '_actions',
      header: 'Hành động',
      render: (_, row) => (
        <div className={styles.actionsCell}>
          {row.approved == 0 && (
            <button className="btn btn-primary btn-sm" onClick={() => handleApprove(row.id)}>
              Duyệt
            </button>
          )}
          {!row.is_default && (
            <button className="btn btn-sm" onClick={() => handleSetDefault(row.id)}>
              Đặt mặc định
            </button>
          )}
          <button className="btn btn-danger btn-sm" onClick={() => setConfirmDeleteId(row.id)}>
            {row.approved == 0 ? 'Từ chối' : 'Xóa'}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className={page.page}>
      <div className={page.header}>
        <h1 className={page.title}>Máy in</h1>
        <div className={page.actions}>
          <button className="btn" onClick={fetchAll} disabled={loading}>
            <RefreshCw size={14} />
            Làm mới
          </button>
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus size={14} />
            Thêm máy in
          </button>
        </div>
      </div>

      {error && !loading ? (
        <div className="card">
          <ErrorState message={error} onRetry={fetchAll} />
        </div>
      ) : loading && rows.length === 0 ? (
        <div className={page.spinnerWrap}>
          <Spinner />
        </div>
      ) : (
        <div className="card">
          <DataTable
            columns={columns}
            rows={rows}
            rowKey="id"
            empty={
              <EmptyState
                title="Chưa có máy in nào"
                message="Thêm máy in hoặc để hệ thống tự phát hiện"
              />
            }
          />
        </div>
      )}

      {/* Modal thêm máy in */}
      <Modal
        open={createOpen}
        title="Thêm máy in"
        onClose={handleCloseCreate}
        footer={
          <>
            <button className="btn btn-ghost" onClick={handleCloseCreate}>
              Hủy
            </button>
            <button
              className="btn btn-primary"
              disabled={createLoading}
              onClick={handleCreateSubmit}
            >
              {createLoading ? 'Đang thêm…' : 'Thêm'}
            </button>
          </>
        }
      >
        <form onSubmit={handleCreateSubmit} noValidate>
          <Field
            label="Chi nhánh"
            htmlFor="printer-branch"
            required
            error={createErrors.branch_id}
          >
            <select
              id="printer-branch"
              className="input"
              value={createForm.branch_id}
              onChange={(e) =>
                setCreateForm((prev) => ({ ...prev, branch_id: e.target.value }))
              }
            >
              <option value="">-- Chọn chi nhánh --</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Tên máy in"
            htmlFor="printer-name"
            required
            error={createErrors.name}
          >
            <input
              id="printer-name"
              type="text"
              className="input"
              placeholder="VD: Máy in tầng 1"
              value={createForm.name}
              onChange={(e) =>
                setCreateForm((prev) => ({ ...prev, name: e.target.value }))
              }
            />
          </Field>
          <Field label="Đặt làm mặc định" htmlFor="printer-default">
            <input
              id="printer-default"
              type="checkbox"
              checked={createForm.is_default}
              onChange={(e) =>
                setCreateForm((prev) => ({ ...prev, is_default: e.target.checked }))
              }
            />
          </Field>
        </form>
      </Modal>

      {/* Dialog xác nhận xóa / từ chối */}
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title={confirmRow?.approved == 0 ? 'Từ chối máy in' : 'Xóa máy in'}
        message={
          confirmRow?.approved == 0
            ? 'Bạn có chắc muốn từ chối máy in này?'
            : 'Bạn có chắc muốn xóa máy in này? Hành động không thể hoàn tác.'
        }
        confirmText={confirmRow?.approved == 0 ? 'Từ chối' : 'Xóa'}
        danger={true}
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

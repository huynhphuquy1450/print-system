import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Plus } from 'lucide-react';
import {
  listBranches,
  listPrinters,
  createPrinter,
  updatePrinter,
  deletePrinter,
} from '../api/client.js';
import { useToast } from '../ui/ToastContext.jsx';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import Field from '../components/Field.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import Spinner from '../components/Spinner.jsx';

const EMPTY_FORM = { branch_id: '', name: '', is_default: false };

export default function PrintersPage() {
  const { toast } = useToast();

  const [rows, setRows] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(false);

  // Xác nhận xóa / từ chối
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Modal thêm máy in
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [createLoading, setCreateLoading] = useState(false);
  const [createErrors, setCreateErrors] = useState({});

  // Tải toàn bộ: branches → printers theo từng branch
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const { branches: list } = await listBranches();
      const branchList = list || [];
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
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

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
      render: (val) => <StatusBadge status={val || 'unknown'} />,
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
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
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
      render: (val) => (val ? '✓ Mặc định' : '—'),
    },
    {
      key: '_actions',
      header: 'Hành động',
      render: (_, row) => (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {row.approved == 0 && (
            <button
              className="btn btn-primary"
              style={{ fontSize: 'var(--font-size-sm)', padding: 'var(--space-1) var(--space-2)' }}
              onClick={() => handleApprove(row.id)}
            >
              Duyệt
            </button>
          )}
          {!row.is_default && (
            <button
              className="btn"
              style={{ fontSize: 'var(--font-size-sm)', padding: 'var(--space-1) var(--space-2)' }}
              onClick={() => handleSetDefault(row.id)}
            >
              Đặt mặc định
            </button>
          )}
          <button
            className="btn btn-danger"
            style={{ fontSize: 'var(--font-size-sm)', padding: 'var(--space-1) var(--space-2)' }}
            onClick={() => setConfirmDeleteId(row.id)}
          >
            {row.approved == 0 ? 'Từ chối' : 'Xóa'}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-4)',
        }}
      >
        <h1>Máy in</h1>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
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

      {loading && rows.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-8)' }}>
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

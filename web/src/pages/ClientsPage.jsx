import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Plus } from 'lucide-react';
import {
  listClients,
  createClient,
  setClientActive,
  rotateClientSecret,
} from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useToast } from '../ui/ToastContext.jsx';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import Field from '../components/Field.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import Spinner from '../components/Spinner.jsx';
import styles from './ClientsPage.module.css';

const EMPTY_CREATE_FORM = { name: '' };

export default function ClientsPage() {
  const { toast } = useToast();
  const { client: currentClient } = useAuth();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Modal tạo client
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM);
  const [createLoading, setCreateLoading] = useState(false);
  const [createErrors, setCreateErrors] = useState({});

  // Modal hiển thị secret (sau tạo mới hoặc rotate)
  const [secretModal, setSecretModal] = useState({ open: false, title: '', secret: '' });

  // Xác nhận rotate secret
  const [confirmRotateId, setConfirmRotateId] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listClients();
      setRows(data.clients || []);
    } catch (err) {
      setError(err.message);
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Toggle kích hoạt / vô hiệu
  async function handleToggleActive(row) {
    const newValue = row.is_active === 1 ? 0 : 1;
    try {
      await setClientActive(row.id, newValue);
      toast(newValue === 1 ? 'Đã kích hoạt client' : 'Đã vô hiệu client', 'success');
      fetchAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // Xác nhận rotate secret
  async function handleConfirmRotate() {
    const id = confirmRotateId;
    setConfirmRotateId(null);
    try {
      const data = await rotateClientSecret(id);
      fetchAll();
      setSecretModal({ open: true, title: 'Secret mới', secret: data.secret });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // Submit form tạo client
  async function handleCreateSubmit(e) {
    e.preventDefault();
    const errors = {};
    if (!createForm.name.trim()) errors.name = 'Tên client không được để trống';
    if (Object.keys(errors).length > 0) {
      setCreateErrors(errors);
      return;
    }
    setCreateErrors({});
    setCreateLoading(true);
    try {
      const data = await createClient(createForm.name.trim());
      setCreateForm(EMPTY_CREATE_FORM);
      setCreateOpen(false);
      toast('Đã tạo client mới', 'success');
      fetchAll();
      setSecretModal({ open: true, title: 'Secret client mới', secret: data.secret });
    } catch (err) {
      if (err.status === 409) {
        setCreateErrors({ name: 'Tên client đã tồn tại' });
      } else {
        toast(err.message, 'error');
      }
    } finally {
      setCreateLoading(false);
    }
  }

  function handleCloseCreate() {
    setCreateOpen(false);
    setCreateForm(EMPTY_CREATE_FORM);
    setCreateErrors({});
  }

  async function handleCopySecret() {
    try {
      await navigator.clipboard.writeText(secretModal.secret);
      toast('Đã sao chép secret', 'success');
    } catch {
      toast('Không thể sao chép — hãy copy thủ công', 'error');
    }
  }

  const columns = [
    { key: 'name', header: 'Tên client' },
    {
      key: 'id',
      header: 'ID',
      render: (val) => <span className={styles.clientId}>{val}</span>,
    },
    {
      key: 'is_active',
      header: 'Trạng thái',
      render: (val) => (
        <StatusBadge status={val === 1 ? 'active' : 'inactive'} />
      ),
    },
    {
      key: 'branch_count',
      header: 'Số chi nhánh',
      render: (val) => val ?? 0,
    },
    {
      key: 'created_at',
      header: 'Ngày tạo',
      render: (val) => (val ? new Date(val).toLocaleString('vi-VN') : '—'),
    },
    {
      key: '_actions',
      header: 'Hành động',
      render: (_, row) => {
        const isSelf = currentClient && row.id === currentClient.id;
        const isActive = row.is_active === 1;
        return (
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            <button
              className={`btn ${isActive ? 'btn-danger' : 'btn-accent'}`}
              style={{ fontSize: 'var(--font-size-sm)', padding: 'var(--space-1) var(--space-2)' }}
              disabled={isActive && isSelf}
              title={isActive && isSelf ? 'Không thể vô hiệu chính client đang đăng nhập' : undefined}
              onClick={() => handleToggleActive(row)}
            >
              {isActive ? 'Vô hiệu' : 'Kích hoạt'}
            </button>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 'var(--font-size-sm)', padding: 'var(--space-1) var(--space-2)' }}
              onClick={() => setConfirmRotateId(row.id)}
            >
              Rotate secret
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Clients</h1>
        <div className={styles.headerActions}>
          <button className="btn" onClick={fetchAll} disabled={loading}>
            <RefreshCw size={14} />
            Làm mới
          </button>
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus size={14} />
            Thêm client
          </button>
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <div className={styles.spinnerWrap}>
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
                title="Chưa có client nào"
                message="Thêm client để bắt đầu kết nối chi nhánh"
              />
            }
          />
        </div>
      )}

      {error && !loading && rows.length === 0 && (
        <p style={{ color: 'var(--color-danger, red)', marginTop: 'var(--space-2)' }}>
          {error}
        </p>
      )}

      {/* Modal tạo client mới */}
      <Modal
        open={createOpen}
        title="Thêm client"
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
              {createLoading ? 'Đang tạo…' : 'Tạo'}
            </button>
          </>
        }
      >
        <form onSubmit={handleCreateSubmit} noValidate>
          <Field
            label="Tên client"
            htmlFor="client-name"
            required
            error={createErrors.name}
          >
            <input
              id="client-name"
              type="text"
              className="input"
              placeholder="VD: Chi nhánh Hà Nội"
              value={createForm.name}
              onChange={(e) =>
                setCreateForm((prev) => ({ ...prev, name: e.target.value }))
              }
            />
          </Field>
        </form>
      </Modal>

      {/* Modal hiển thị secret (tạo mới / rotate) */}
      <Modal
        open={secretModal.open}
        title={secretModal.title}
        onClose={() => setSecretModal({ open: false, title: '', secret: '' })}
        footer={
          <button
            className="btn btn-ghost"
            onClick={() => setSecretModal({ open: false, title: '', secret: '' })}
          >
            Đóng
          </button>
        }
      >
        <p className={styles.secretWarning}>
          Lưu ngay — secret chỉ hiển thị 1 lần, không xem lại được.
        </p>
        <code className={styles.secretBox}>{secretModal.secret}</code>
        <div className={styles.secretActions}>
          <button className="btn btn-primary" onClick={handleCopySecret}>
            Sao chép
          </button>
        </div>
      </Modal>

      {/* Dialog xác nhận rotate secret */}
      <ConfirmDialog
        open={confirmRotateId !== null}
        title="Rotate secret"
        message="Rotate secret cho client này? Secret cũ sẽ vô hiệu cho các lần đăng ký branch sau; agent đang chạy KHÔNG bị ảnh hưởng."
        confirmText="Rotate"
        danger={false}
        onCancel={() => setConfirmRotateId(null)}
        onConfirm={handleConfirmRotate}
      />
    </div>
  );
}

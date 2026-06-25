import { useState, useEffect, useCallback } from 'react';
import { Trash2, Copy, AlertTriangle } from 'lucide-react';
import { listWebhooks, createWebhook, deleteWebhook } from '../api/client.js';
import { useToast } from '../ui/ToastContext.jsx';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import Field from '../components/Field.jsx';
import EmptyState from '../components/EmptyState.jsx';
import Spinner from '../components/Spinner.jsx';
import styles from './WebhooksPage.module.css';

// Trạng thái khởi tạo cho form tạo webhook
const EMPTY_FORM = { url: '', events: '' };

export default function WebhooksPage() {
  const { toast } = useToast();

  // Danh sách webhook
  const [webhooks, setWebhooks] = useState([]);
  const [loading, setLoading] = useState(false);

  // Trạng thái xoá
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Form tạo mới
  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [createLoading, setCreateLoading] = useState(false);
  const [createErrors, setCreateErrors] = useState({});

  // Modal hiển thị secret sau khi tạo thành công
  const [secretModal, setSecretModal] = useState({ open: false, secret: '' });

  // Tải danh sách webhooks từ server
  const fetchWebhooks = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listWebhooks();
      setWebhooks(result.webhooks || []);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Tải lần đầu khi mount
  useEffect(() => {
    fetchWebhooks();
  }, [fetchWebhooks]);

  // Xử lý submit form tạo webhook
  async function handleCreateSubmit(e) {
    e.preventDefault();

    // Validate url không được rỗng
    const errors = {};
    if (!createForm.url.trim()) {
      errors.url = 'URL không được để trống';
    }
    if (Object.keys(errors).length > 0) {
      setCreateErrors(errors);
      return;
    }

    setCreateErrors({});
    setCreateLoading(true);
    try {
      const payload = { url: createForm.url };
      if (createForm.events.trim()) {
        payload.events = createForm.events.trim();
      }
      const result = await createWebhook(payload);
      // Xoá form sau khi tạo thành công
      setCreateForm(EMPTY_FORM);
      // Hiển thị modal với secret trả về
      setSecretModal({ open: true, secret: result.secret });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setCreateLoading(false);
    }
  }

  // Đóng modal secret và reload danh sách
  function handleSecretModalClose() {
    setSecretModal({ open: false, secret: '' });
    fetchWebhooks();
  }

  // Xác nhận xoá webhook
  async function handleConfirmDelete() {
    const idToDelete = confirmDeleteId;
    setDeletingId(idToDelete);
    setConfirmDeleteId(null);
    try {
      await deleteWebhook(idToDelete);
      toast('Đã xóa webhook', 'success');
      fetchWebhooks();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setDeletingId(null);
    }
  }

  // Cột của bảng danh sách webhooks
  const columns = [
    {
      key: 'id',
      header: 'ID',
      render: (val) => (
        <span
          style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)' }}
          title={val}
        >
          {val}
        </span>
      ),
    },
    {
      key: 'url',
      header: 'URL',
      render: (val) => (
        <span
          title={val}
          style={{
            maxWidth: '200px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            display: 'block',
          }}
        >
          {val}
        </span>
      ),
    },
    {
      key: 'events',
      header: 'Events',
      render: (val) => (Array.isArray(val) ? val.join(', ') : val || '—'),
    },
    {
      key: 'is_active',
      header: 'Trạng thái',
      render: (val) => (
        <span
          style={{
            color: val ? 'var(--color-success)' : 'var(--color-muted-fg)',
            fontWeight: '600',
          }}
        >
          {val ? 'Bật' : 'Tắt'}
        </span>
      ),
    },
    {
      key: 'created_at',
      header: 'Tạo lúc',
      render: (val) => new Date(val).toLocaleString('vi-VN'),
    },
    {
      key: '_actions',
      header: 'Hành động',
      render: (_, row) => (
        <button
          className="btn btn-danger"
          style={{ fontSize: 'var(--font-size-sm)', padding: 'var(--space-1) var(--space-2)' }}
          disabled={deletingId === row.id}
          onClick={() => setConfirmDeleteId(row.id)}
        >
          <Trash2 size={14} />
          Xóa
        </button>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      <h1>Webhooks</h1>

      {/* Form tạo webhook mới */}
      <div className={`card ${styles.section}`}>
        <h2>Thêm Webhook</h2>
        <form onSubmit={handleCreateSubmit} noValidate>
          <Field
            label="URL"
            htmlFor="webhook-url"
            required
            error={createErrors.url}
          >
            <input
              id="webhook-url"
              type="url"
              className="input"
              placeholder="https://..."
              value={createForm.url}
              onChange={(e) =>
                setCreateForm((prev) => ({ ...prev, url: e.target.value }))
              }
            />
          </Field>
          <Field
            label="Events"
            htmlFor="webhook-events"
            hint="Để trống để nhận mọi sự kiện; nhiều event cách nhau dấu phẩy"
            error={createErrors.events}
          >
            <input
              id="webhook-events"
              type="text"
              className="input"
              placeholder="job.status"
              value={createForm.events}
              onChange={(e) =>
                setCreateForm((prev) => ({ ...prev, events: e.target.value }))
              }
            />
          </Field>
          <div className={styles.formActions}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={createLoading}
            >
              {createLoading ? 'Đang tạo…' : 'Tạo Webhook'}
            </button>
          </div>
        </form>
      </div>

      {/* Danh sách webhooks */}
      <div className={`card ${styles.section}`}>
        <h2>Danh sách Webhooks</h2>
        {loading && webhooks.length === 0 ? (
          <div className={styles.spinnerWrap}>
            <Spinner />
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={webhooks}
            rowKey="id"
            empty={
              <EmptyState
                title="Chưa có webhook nào"
                message="Tạo webhook đầu tiên bằng form bên trên"
              />
            }
          />
        )}
      </div>

      {/* Modal hiển thị secret sau khi tạo thành công */}
      <Modal
        open={secretModal.open}
        title="Webhook đã tạo"
        onClose={handleSecretModalClose}
        footer={
          <button className="btn btn-primary" onClick={handleSecretModalClose}>
            Đã lưu, đóng lại
          </button>
        }
      >
        {/* Cảnh báo secret chỉ hiện một lần */}
        <div className={styles.warningBox}>
          <AlertTriangle size={16} />
          <span>
            Secret <strong>CHỈ hiện 1 lần này</strong>. Lưu lại ngay — sẽ không xem lại được.
          </span>
        </div>
        <div>
          <span style={{ fontWeight: '600' }}>Secret:</span>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              wordBreak: 'break-all',
              padding: 'var(--space-2)',
              background: 'var(--color-muted)',
              borderRadius: 'var(--radius)',
              margin: 'var(--space-2) 0',
            }}
          >
            {secretModal.secret}
          </div>
        </div>
        {/* Nút copy secret vào clipboard */}
        <div className={styles.copyBtn}>
          <button
            className="btn btn-accent"
            onClick={() =>
              navigator.clipboard
                .writeText(secretModal.secret)
                .then(() => toast('Đã copy secret', 'success'))
            }
          >
            <Copy size={14} />
            Sao chép Secret
          </button>
        </div>
      </Modal>

      {/* Dialog xác nhận xoá */}
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Xóa Webhook"
        message="Bạn có chắc muốn xóa webhook này? Hành động không thể hoàn tác."
        confirmText="Xóa"
        danger={true}
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

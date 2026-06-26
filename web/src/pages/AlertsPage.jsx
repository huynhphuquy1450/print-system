import { useState, useEffect, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import { listBranches, listAlerts, deleteAlert } from '../api/client.js';
import { useToast } from '../ui/ToastContext.jsx';
import DataTable from '../components/DataTable.jsx';
import Pagination from '../components/Pagination.jsx';
import Field from '../components/Field.jsx';
import FilterBar from '../components/FilterBar.jsx';
import EmptyState from '../components/EmptyState.jsx';
import Spinner from '../components/Spinner.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import styles from './AlertsPage.module.css';

const EMPTY_FILTER = { alert_type: '', branch_id: '', from: '', to: '' };

const ALERT_LABELS = {
  'branch.offline': 'Chi nhánh mất kết nối',
  'branch.online': 'Chi nhánh phục hồi',
  'printer.offline': 'Máy in mất kết nối',
  'printer.online': 'Máy in phục hồi',
  'printer.out_of_paper': 'Hết giấy',
  'printer.paper_jam': 'Kẹt giấy',
};

// Loại alert "phục hồi" → màu xanh; còn lại → màu đỏ/cam
function alertColor(alertType) {
  if (alertType === 'branch.online' || alertType === 'printer.online') {
    return 'var(--color-success)';
  }
  return 'var(--color-destructive, var(--color-danger, #dc2626))';
}

export default function AlertsPage() {
  const { toast } = useToast();

  const [branches, setBranches] = useState([]);
  const [filterDraft, setFilterDraft] = useState(EMPTY_FILTER);
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [pagination, setPagination] = useState({ limit: 50, offset: 0 });

  const [alerts, setAlerts] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const branchMap = Object.fromEntries(branches.map((b) => [String(b.id), b.name]));

  // Tải danh sách chi nhánh một lần khi mount
  useEffect(() => {
    listBranches()
      .then(({ branches: list }) => setBranches(list || []))
      .catch(() => {});
  }, []);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { limit: pagination.limit, offset: pagination.offset };
      if (filter.alert_type) params.alert_type = filter.alert_type;
      if (filter.branch_id) params.branch_id = filter.branch_id;
      if (filter.from) params.from = new Date(filter.from).getTime();
      if (filter.to) params.to = new Date(filter.to).getTime();

      const result = await listAlerts(params);
      setAlerts(result.alerts || []);
      setTotal(result.total || 0);
    } catch (err) {
      toast(err.message, 'error');
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filter, pagination, toast]);

  // Poll mỗi 12 giây
  useEffect(() => {
    fetchAlerts();
    const id = setInterval(fetchAlerts, 12000);
    return () => clearInterval(id);
  }, [fetchAlerts]);

  function handleFilterSubmit() {
    setFilter({ ...filterDraft });
    setPagination({ limit: 50, offset: 0 });
  }

  function handleFilterReset() {
    setFilterDraft({ ...EMPTY_FILTER });
    setFilter({ ...EMPTY_FILTER });
    setPagination({ limit: 50, offset: 0 });
  }

  async function handleConfirmDelete() {
    const idToDelete = confirmDeleteId;
    setDeletingId(idToDelete);
    setConfirmDeleteId(null);
    try {
      await deleteAlert(idToDelete);
      toast('Đã xóa cảnh báo', 'success');
      fetchAlerts();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setDeletingId(null);
    }
  }

  function updateDraft(key, value) {
    setFilterDraft((prev) => ({ ...prev, [key]: value }));
  }

  const columns = [
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
      render: (val) => (
        <span className={styles.typeBadge}>
          <span
            className={styles.typeDot}
            style={{ backgroundColor: alertColor(val) }}
          />
          {ALERT_LABELS[val] || val}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Trạng thái',
      render: (val) => val || '—',
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
      <div className={styles.header}>
        <h1>Lịch sử Cảnh báo</h1>
        <span className={styles.total}>Tổng: {total}</span>
      </div>

      <FilterBar onSubmit={handleFilterSubmit} onReset={handleFilterReset}>
        <Field label="Loại cảnh báo" htmlFor="filter-alert-type">
          <select
            id="filter-alert-type"
            value={filterDraft.alert_type}
            onChange={(e) => updateDraft('alert_type', e.target.value)}
          >
            <option value="">Tất cả</option>
            {Object.entries(ALERT_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Chi nhánh" htmlFor="filter-branch">
          <select
            id="filter-branch"
            value={filterDraft.branch_id}
            onChange={(e) => updateDraft('branch_id', e.target.value)}
          >
            <option value="">Tất cả</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Từ ngày" htmlFor="filter-from">
          <input
            id="filter-from"
            type="datetime-local"
            value={filterDraft.from}
            onChange={(e) => updateDraft('from', e.target.value)}
          />
        </Field>

        <Field label="Đến ngày" htmlFor="filter-to">
          <input
            id="filter-to"
            type="datetime-local"
            value={filterDraft.to}
            onChange={(e) => updateDraft('to', e.target.value)}
          />
        </Field>
      </FilterBar>

      {loading && alerts.length === 0 && (
        <div className={styles.spinnerWrap}>
          <Spinner />
        </div>
      )}

      <DataTable
        columns={columns}
        rows={alerts}
        rowKey="id"
        empty={
          <EmptyState
            title="Chưa có cảnh báo nào"
            message="Thử thay đổi bộ lọc"
          />
        }
      />

      {total > 0 && (
        <Pagination
          limit={pagination.limit}
          offset={pagination.offset}
          total={total}
          onChange={(off, lim) =>
            setPagination({ offset: off, limit: lim ?? pagination.limit })
          }
        />
      )}

      {error && !loading && alerts.length === 0 && (
        <p style={{ color: 'var(--color-danger, red)', marginTop: 'var(--space-2)' }}>
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Xóa cảnh báo"
        message="Bạn có chắc muốn xóa cảnh báo này? Hành động không thể hoàn tác."
        confirmText="Xóa"
        danger
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

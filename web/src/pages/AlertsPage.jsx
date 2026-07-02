import { useState, useEffect, useCallback, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { listAlerts, deleteAlert } from '../api/client.js';
import { getBranches } from '../api/branchesCache.js';
import { useToast } from '../ui/ToastContext.jsx';
import { usePolling } from '../hooks/usePolling.js';
import { useUrlState } from '../hooks/useUrlState.js';
import DataTable from '../components/DataTable.jsx';
import Pagination from '../components/Pagination.jsx';
import Field from '../components/Field.jsx';
import FilterBar from '../components/FilterBar.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import Spinner from '../components/Spinner.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import page from '../components/Page.module.css';
import styles from './AlertsPage.module.css';

const EMPTY_FILTER = { alert_type: '', branch_id: '', from: '', to: '' };
const DEFAULT_LIMIT = 50;

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

// Loại alert "phục hồi" → chấm xanh (success); còn lại → chấm đỏ (destructive)
function alertDotClass(alertType) {
  if (alertType === 'branch.online' || alertType === 'printer.online') {
    return styles.typeDotSuccess;
  }
  return styles.typeDotDanger;
}

export default function AlertsPage() {
  const { toast } = useToast();
  const { get, setMany } = useUrlState();

  const [branches, setBranches] = useState([]);

  // Filter/pagination hiện tại — đọc trực tiếp từ URL (nguồn sự thật duy nhất),
  // nên F5 và nút Back/Forward của trình duyệt luôn khôi phục đúng view.
  const alertType = get('alert_type', '');
  const branchId = get('branch_id', '');
  const from = get('from', '');
  const to = get('to', '');
  const limit = Number(get('limit', String(DEFAULT_LIMIT))) || DEFAULT_LIMIT;
  const offset = Number(get('offset', '0')) || 0;

  // filterDraft: giá trị đang nhập trên form (chưa áp dụng). Đồng bộ lại từ URL
  // mỗi khi giá trị áp dụng thay đổi (submit, reset, Back/Forward, F5).
  const [filterDraft, setFilterDraft] = useState({
    alert_type: alertType,
    branch_id: branchId,
    from,
    to,
  });

  useEffect(() => {
    setFilterDraft({ alert_type: alertType, branch_id: branchId, from, to });
  }, [alertType, branchId, from, to]);

  const [alerts, setAlerts] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // true sau khi đã tải thành công ít nhất 1 lần — dùng để phân biệt lỗi
  // ở lần tải đầu (chặn cả bảng) với lỗi khi poll nền (giữ nguyên dữ liệu cũ)
  const loadedOnceRef = useRef(false);

  const branchMap = Object.fromEntries(branches.map((b) => [String(b.id), b.name]));

  // Tải danh sách chi nhánh một lần (dùng cache dùng chung giữa các trang)
  useEffect(() => {
    getBranches()
      .then(setBranches)
      .catch(() => {});
  }, []);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit, offset };
      if (alertType) params.alert_type = alertType;
      if (branchId) params.branch_id = branchId;
      if (from) params.from = new Date(from).getTime();
      if (to) params.to = new Date(to).getTime();

      const result = await listAlerts(params);
      setAlerts(result.alerts || []);
      setTotal(result.total || 0);
      setError(null);
      loadedOnceRef.current = true;
    } catch (err) {
      if (loadedOnceRef.current) {
        // Đã có dữ liệu hiển thị — đây là lỗi poll nền, không xóa bảng hiện có
        toast(err.message, 'error');
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [alertType, branchId, from, to, limit, offset, toast]);

  // Fetch lại mỗi khi filter/pagination trên URL thay đổi
  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  // Poll nền mỗi 12 giây với tham số hiện tại (tạm dừng khi tab bị ẩn)
  usePolling(fetchAlerts, 12000);

  function handleFilterSubmit() {
    setMany({ ...filterDraft, offset: '' });
  }

  function handleFilterReset() {
    setFilterDraft({ ...EMPTY_FILTER });
    setMany({ ...EMPTY_FILTER, offset: '' });
  }

  function handlePaginationChange(newOffset, newLimit) {
    setMany({
      offset: newOffset || '',
      limit: newLimit && newLimit !== DEFAULT_LIMIT ? newLimit : '',
    });
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
          <span className={`${styles.typeDot} ${alertDotClass(val)}`} />
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
        <span className={page.actionCell}>
          <button
            className="btn btn-danger btn-sm"
            disabled={deletingId === row.id}
            onClick={() => setConfirmDeleteId(row.id)}
          >
            <Trash2 size={14} />
            Xóa
          </button>
        </span>
      ),
    },
  ];

  return (
    <div className={page.page}>
      <div className={page.header}>
        <h1 className={page.title}>Lịch sử Cảnh báo</h1>
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

      {loading && alerts.length === 0 && !error && (
        <div className={page.spinnerWrap}>
          <Spinner />
        </div>
      )}

      {error && alerts.length === 0 ? (
        <ErrorState message={error} onRetry={fetchAlerts} />
      ) : (
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
      )}

      {total > 0 && (
        <Pagination
          limit={limit}
          offset={offset}
          total={total}
          onChange={handlePaginationChange}
        />
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

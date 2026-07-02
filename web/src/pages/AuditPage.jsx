import { useState, useEffect, useCallback } from 'react';
import { listAudit } from '../api/client.js';
import { useToast } from '../ui/ToastContext.jsx';
import { useUrlState } from '../hooks/useUrlState.js';
import DataTable from '../components/DataTable.jsx';
import Pagination from '../components/Pagination.jsx';
import Field from '../components/Field.jsx';
import FilterBar from '../components/FilterBar.jsx';
import EmptyState from '../components/EmptyState.jsx';
import Spinner from '../components/Spinner.jsx';
import ErrorState from '../components/ErrorState.jsx';
import styles from './AuditPage.module.css';

// Trạng thái rỗng ban đầu của form lọc
const EMPTY_FILTER = { actor_id: '', action: '', from: '', to: '' };

export default function AuditPage() {
  const { toast } = useToast();
  const { get, setMany } = useUrlState();

  // Bộ lọc + phân trang đang áp dụng, lấy trực tiếp từ URL
  const actorId = get('actor_id', '');
  const action = get('action', '');
  const from = get('from', '');
  const to = get('to', '');
  const limit = Number(get('limit', '50')) || 50;
  const offset = Number(get('offset', '0')) || 0;

  // filterDraft: giá trị đang nhập trên form (chưa áp dụng)
  const [filterDraft, setFilterDraft] = useState({ actor_id: actorId, action, from, to });

  // Đồng bộ filterDraft khi URL thay đổi từ bên ngoài (Back/Forward, F5)
  useEffect(() => {
    setFilterDraft({ actor_id: actorId, action, from, to });
  }, [actorId, action, from, to]);

  // Dữ liệu
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Tải danh sách audit log; chạy lại khi filter hoặc pagination (từ URL) thay đổi
  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { limit, offset };
      if (actorId) params.actor_id = actorId;
      if (action) params.action = action;
      if (from) params.from = new Date(from).getTime();
      if (to) params.to = new Date(to).getTime();

      const result = await listAudit(params);
      setEntries(result.entries || []);
      setTotal(result.total || 0);
    } catch (err) {
      toast(err.message, 'error');
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [actorId, action, from, to, limit, offset, toast]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Áp dụng bộ lọc và reset về trang đầu
  function handleFilterSubmit() {
    setMany({
      actor_id: filterDraft.actor_id,
      action: filterDraft.action,
      from: filterDraft.from,
      to: filterDraft.to,
      offset: 0,
    });
  }

  // Xóa bộ lọc và reset trang
  function handleFilterReset() {
    setFilterDraft({ ...EMPTY_FILTER });
    setMany({ actor_id: '', action: '', from: '', to: '', offset: 0 });
  }

  // Cập nhật một trường trong filterDraft
  function updateDraft(key, value) {
    setFilterDraft((prev) => ({ ...prev, [key]: value }));
  }

  // Xác định class màu của HTTP status code
  function statusClass(code) {
    if (code >= 200 && code < 300) return styles.statusSuccess;
    if (code >= 400 && code < 500) return styles.statusWarning;
    if (code >= 500) return styles.statusDestructive;
    return '';
  }

  // Định nghĩa cột bảng
  const columns = [
    {
      key: 'at',
      header: 'Thời gian',
      render: (val) => new Date(val).toLocaleString('vi-VN'),
    },
    {
      key: 'actor_type',
      header: 'Loại actor',
    },
    {
      key: 'actor_id',
      header: 'Actor ID',
      render: (val) => <span className={styles.actorId}>{val}</span>,
    },
    {
      key: 'action',
      header: 'Hành động',
    },
    {
      key: 'resource',
      header: 'Tài nguyên',
      render: (_, row) =>
        row.resource_type && row.resource_id
          ? `${row.resource_type}:${row.resource_id}`
          : row.resource_type || row.resource_id || '—',
    },
    {
      key: 'method',
      header: 'Method',
    },
    {
      key: 'path',
      header: 'Path',
    },
    {
      key: 'status_code',
      header: 'Status',
      render: (val) => <span className={`${styles.statusCode} ${statusClass(val)}`}>{val}</span>,
    },
    {
      key: 'ip',
      header: 'IP',
    },
  ];

  return (
    <div className={styles.page}>
      {/* Tiêu đề trang */}
      <div className={styles.header}>
        <h1>Nhật ký Audit</h1>
        <span className={styles.total}>Tổng: {total} bản ghi</span>
      </div>

      {/* Bộ lọc */}
      <FilterBar onSubmit={handleFilterSubmit} onReset={handleFilterReset}>
        <Field label="Actor ID" htmlFor="filter-actor-id">
          <input
            id="filter-actor-id"
            type="text"
            value={filterDraft.actor_id}
            onChange={(e) => updateDraft('actor_id', e.target.value)}
          />
        </Field>

        <Field label="Action" htmlFor="filter-action" hint="vd: job.retry, job.create...">
          <input
            id="filter-action"
            type="text"
            placeholder="vd: job.retry"
            value={filterDraft.action}
            onChange={(e) => updateDraft('action', e.target.value)}
          />
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

      {/* Spinner hiển thị khi đang tải lần đầu */}
      {loading && entries.length === 0 && (
        <div className={styles.spinnerWrap}>
          <Spinner />
        </div>
      )}

      {/* Lỗi tải danh sách và không có dữ liệu để hiển thị */}
      {error && !loading && entries.length === 0 ? (
        <ErrorState message={error} onRetry={fetchEntries} />
      ) : (
        <>
          {/* Bảng danh sách */}
          <div className="table-wrapper">
            <DataTable
              columns={columns}
              rows={entries}
              rowKey={(row, i) => (row.id != null ? row.id : i)}
              empty={
                <EmptyState
                  title="Không có bản ghi audit"
                  message="Thử thay đổi bộ lọc để xem kết quả khác"
                />
              }
            />
          </div>

          {/* Phân trang */}
          {total > 0 && (
            <Pagination
              limit={limit}
              offset={offset}
              total={total}
              onChange={(off, lim) => setMany({ offset: off, limit: lim ?? limit })}
            />
          )}
        </>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Eye, Copy } from 'lucide-react';
import { listBranches, listJobs, retryJob, ApiError } from '../api/client.js';
import { useToast } from '../ui/ToastContext.jsx';
import DataTable from '../components/DataTable.jsx';
import Pagination from '../components/Pagination.jsx';
import Modal from '../components/Modal.jsx';
import Field from '../components/Field.jsx';
import FilterBar from '../components/FilterBar.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import Spinner from '../components/Spinner.jsx';
import styles from './JobsPage.module.css';

const EMPTY_FILTER = { branch_id: '', status: '', from: '', to: '' };

export default function JobsPage() {
  const { toast } = useToast();

  // Chi nhánh — tải một lần khi mount
  const [branches, setBranches] = useState([]);

  // filterDraft: giá trị đang nhập trên form (chưa áp dụng)
  // filter: bộ lọc đang thực sự được dùng để query
  const [filterDraft, setFilterDraft] = useState(EMPTY_FILTER);
  const [filter, setFilter] = useState(EMPTY_FILTER);

  // Phân trang
  const [pagination, setPagination] = useState({ limit: 50, offset: 0 });

  // Dữ liệu
  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Modal chi tiết job
  const [detailJob, setDetailJob] = useState(null);

  // ID của job đang được retry
  const [retryingId, setRetryingId] = useState(null);

  // Map branch_id → tên chi nhánh để hiển thị
  const branchMap = Object.fromEntries(branches.map((b) => [String(b.id), b.name]));

  // Tải danh sách chi nhánh một lần khi mount; bỏ qua lỗi
  useEffect(() => {
    listBranches()
      .then(({ branches: list }) => setBranches(list || []))
      .catch(() => {});
  }, []);

  // Tải danh sách jobs; chạy lại khi filter hoặc pagination thay đổi
  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { limit: pagination.limit, offset: pagination.offset };
      if (filter.branch_id) params.branch_id = filter.branch_id;
      if (filter.status) params.status = filter.status;
      if (filter.from) params.from = new Date(filter.from).getTime();
      if (filter.to) params.to = new Date(filter.to).getTime();

      const result = await listJobs(params);
      setJobs(result.jobs || []);
      setTotal(result.total || 0);
    } catch (err) {
      toast(err.message, 'error');
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filter, pagination, toast]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Áp dụng bộ lọc và reset về trang đầu
  function handleFilterSubmit() {
    setFilter({ ...filterDraft });
    setPagination({ limit: 50, offset: 0 });
  }

  // Xóa bộ lọc và reset trang
  function handleFilterReset() {
    setFilterDraft({ ...EMPTY_FILTER });
    setFilter({ ...EMPTY_FILTER });
    setPagination({ limit: 50, offset: 0 });
  }

  // Cập nhật một trường trong filterDraft
  function updateDraft(key, value) {
    setFilterDraft((prev) => ({ ...prev, [key]: value }));
  }

  // Thực hiện retry một job
  async function handleRetry(row) {
    setRetryingId(row.id);
    try {
      await retryJob(row.id);
      toast('Đã retry job thành công', 'success');
      fetchJobs();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) toast('Chỉ retry được job failed', 'error');
        else if (err.status === 410) toast('PDF đã bị cleanup, không thể retry', 'error');
        else toast(err.message, 'error');
      } else {
        toast(err.message, 'error');
      }
    } finally {
      setRetryingId(null);
    }
  }

  // Định nghĩa cột bảng
  const columns = [
    {
      key: 'id',
      header: 'ID',
      render: (val) => (
        <span className={styles.idCell}>
          <span
            style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)' }}
            title={val}
          >
            {val.slice(0, 8)}…
          </span>
          <button
            className="btn btn-ghost"
            style={{ padding: '2px 4px', fontSize: '12px', lineHeight: 1 }}
            title="Copy ID"
            onClick={() =>
              navigator.clipboard.writeText(val).then(() => toast('Đã copy ID', 'success'))
            }
          >
            <Copy size={12} />
          </button>
        </span>
      ),
    },
    {
      key: 'branch_id',
      header: 'Chi nhánh',
      render: (val) => branchMap[String(val)] || val,
    },
    {
      key: 'status',
      header: 'Trạng thái',
      render: (val) => <StatusBadge status={val} />,
    },
    {
      key: 'retry_count',
      header: 'Retry',
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
        <span className={styles.actionCell}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: '12px', padding: '3px 8px' }}
            onClick={() => setDetailJob(row)}
          >
            <Eye size={12} /> Chi tiết
          </button>
          <button
            className="btn btn-accent"
            style={{ fontSize: '12px', padding: '3px 8px' }}
            disabled={row.status !== 'failed' || retryingId === row.id}
            title={row.status !== 'failed' ? 'Chỉ retry được job ở trạng thái failed' : undefined}
            onClick={() => handleRetry(row)}
          >
            {retryingId === row.id ? <Spinner size={12} /> : <RefreshCw size={12} />}
            Retry
          </button>
        </span>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      {/* Tiêu đề trang */}
      <div className={styles.header}>
        <h1>Danh sách Jobs</h1>
        <span className={styles.total}>Tổng: {total} jobs</span>
      </div>

      {/* Bộ lọc */}
      <FilterBar onSubmit={handleFilterSubmit} onReset={handleFilterReset}>
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

        <Field label="Trạng thái" htmlFor="filter-status">
          <select
            id="filter-status"
            value={filterDraft.status}
            onChange={(e) => updateDraft('status', e.target.value)}
          >
            <option value="">Tất cả</option>
            <option value="pending">pending</option>
            <option value="sent">sent</option>
            <option value="printed">printed</option>
            <option value="failed">failed</option>
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

      {/* Spinner hiển thị khi tải lần đầu */}
      {loading && jobs.length === 0 && (
        <div className={styles.spinnerWrap}>
          <Spinner />
        </div>
      )}

      {/* Bảng danh sách */}
      <DataTable
        columns={columns}
        rows={jobs}
        rowKey="id"
        empty={
          <EmptyState
            title="Không có job nào"
            message="Thử thay đổi bộ lọc hoặc tạo job mới"
          />
        }
      />

      {/* Phân trang */}
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

      {/* Modal chi tiết job */}
      <Modal open={!!detailJob} title="Chi tiết Job" onClose={() => setDetailJob(null)}>
        {detailJob && (
          <div className={styles.detail}>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>ID</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                {detailJob.id}
              </span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Chi nhánh</span>
              <span>{branchMap[String(detailJob.branch_id)] || detailJob.branch_id}</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Trạng thái</span>
              <StatusBadge status={detailJob.status} />
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Retry</span>
              <span>{detailJob.retry_count}</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Tạo lúc</span>
              <span>{new Date(detailJob.created_at).toLocaleString('vi-VN')}</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Máy in</span>
              <span>{detailJob.printer || '—'}</span>
            </div>
            {detailJob.metadata && (
              <div className={styles.detailSection}>
                <span className={styles.detailLabel}>Metadata</span>
                <pre className={styles.detailPre}>
                  {JSON.stringify(detailJob.metadata, null, 2)}
                </pre>
              </div>
            )}
            {detailJob.error && (
              <div className={styles.detailSection}>
                <span className={styles.detailLabel}>Lỗi</span>
                <pre className={styles.detailPre}>{detailJob.error}</pre>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Hiển thị thông báo lỗi khi fetch thất bại */}
      {error && !loading && jobs.length === 0 && (
        <p style={{ color: 'var(--color-danger, red)', marginTop: 'var(--space-2)' }}>{error}</p>
      )}
    </div>
  );
}

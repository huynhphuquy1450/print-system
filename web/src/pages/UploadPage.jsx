import { useState, useEffect } from 'react';
import { listBranches, createJob, bulkCreate } from '../api/client.js';
import { useToast } from '../ui/ToastContext.jsx';
import Field from '../components/Field.jsx';
import Spinner from '../components/Spinner.jsx';
import styles from './UploadPage.module.css';

// Kiểm tra file có đuôi .pdf không
function isPdf(file) {
  return file.name.toLowerCase().endsWith('.pdf');
}

export default function UploadPage() {
  const { toast } = useToast();

  // Tab đang hiển thị
  const [activeTab, setActiveTab] = useState('single');

  // Danh sách chi nhánh tải khi mount
  const [branches, setBranches] = useState([]);

  // Tải danh sách chi nhánh một lần; bỏ qua lỗi
  useEffect(() => {
    listBranches()
      .then(({ branches: list }) => setBranches(list || []))
      .catch(() => {});
  }, []);

  // ── Tab đơn lẻ ────────────────────────────────────────────
  const [file, setFile] = useState(null);
  const [branchId, setBranchId] = useState('');
  const [printer, setPrinter] = useState('');
  const [userId, setUserId] = useState('');
  const [singleLoading, setSingleLoading] = useState(false);
  const [resultJobId, setResultJobId] = useState(null);
  const [errors, setErrors] = useState({});

  // Xử lý chọn file đơn
  function handleFileChange(e) {
    const chosen = e.target.files[0] || null;
    setFile(chosen);
    if (chosen && !isPdf(chosen)) {
      setErrors((prev) => ({ ...prev, file: 'File phải có định dạng .pdf' }));
    } else {
      setErrors((prev) => ({ ...prev, file: undefined }));
    }
  }

  // Submit form đơn lẻ
  async function handleSingleSubmit(e) {
    e.preventDefault();

    // Validate
    const newErrors = {};
    if (!file) newErrors.file = 'Vui lòng chọn file PDF';
    else if (!isPdf(file)) newErrors.file = 'File phải có định dạng .pdf';
    if (!branchId) newErrors.branchId = 'Vui lòng chọn chi nhánh';
    if (!userId.trim()) newErrors.userId = 'Vui lòng nhập User ID';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});

    // Xây FormData
    const fd = new FormData();
    fd.append('pdf', file);
    fd.append('branch_id', branchId);
    if (printer.trim()) fd.append('printer', printer.trim());
    fd.append('metadata', JSON.stringify({ user_id: userId.trim() }));

    setSingleLoading(true);
    try {
      const job = await createJob(fd);
      toast('Tạo job thành công!', 'success');
      setResultJobId(job.id ?? job.job_id ?? null);
      // Xóa form
      setFile(null);
      setBranchId('');
      setPrinter('');
      setUserId('');
      e.target.reset();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSingleLoading(false);
    }
  }

  // ── Tab hàng loạt ─────────────────────────────────────────
  const [files, setFiles] = useState([]);
  // items: [{branchId, printer, userId}] — tương ứng từng file
  const [items, setItems] = useState([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const [fileError, setFileError] = useState('');

  // Xử lý chọn nhiều file
  function handleBulkFileChange(e) {
    const chosen = Array.from(e.target.files);
    if (chosen.length > 20) {
      setFileError('Chỉ được chọn tối đa 20 file');
      setFiles([]);
      setItems([]);
      e.target.value = '';
      return;
    }
    setFileError('');
    setFiles(chosen);
    setItems(chosen.map(() => ({ branchId: '', printer: '', userId: '' })));
  }

  // Cập nhật một trường của item theo index
  function updateItem(index, field, value) {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  // Submit form hàng loạt
  async function handleBulkSubmit(e) {
    e.preventDefault();

    // Validate thông tin từng dòng
    const missing = items.some((it) => !it.branchId || !it.userId.trim());
    if (missing) {
      toast('Vui lòng điền đủ thông tin cho tất cả file', 'error');
      return;
    }

    // Validate tất cả file đều là .pdf
    const nonPdf = files.some((f) => !isPdf(f));
    if (nonPdf) {
      toast('Tất cả file phải có định dạng .pdf', 'error');
      return;
    }

    // Xây FormData: thứ tự file phải khớp với items
    const fd = new FormData();
    files.forEach((f) => fd.append('pdf', f));
    fd.append(
      'items',
      JSON.stringify(
        items.map((it) => ({
          branch_id: it.branchId,
          ...(it.printer.trim() ? { printer: it.printer.trim() } : {}),
          metadata: { user_id: it.userId.trim() },
        }))
      )
    );

    setBulkLoading(true);
    setBulkResult(null);
    try {
      const result = await bulkCreate(fd);
      const created = result.created || [];
      const failed = result.failed || [];

      if (failed.length > 0) {
        toast(
          `${created.length}/${files.length} job tạo thành công, ${failed.length} thất bại`,
          'info'
        );
      } else {
        toast(`Tất cả ${files.length} job đã tạo thành công!`, 'success');
      }
      setBulkResult(result);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBulkLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Upload Job In</h1>

      {/* Tab bar */}
      <div className={styles.tabBar} role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === 'single'}
          className={`${styles.tab} ${activeTab === 'single' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('single')}
        >
          Đơn lẻ
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'bulk'}
          className={`${styles.tab} ${activeTab === 'bulk' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('bulk')}
        >
          Hàng loạt
        </button>
      </div>

      {/* ── Tab đơn lẻ ── */}
      {activeTab === 'single' && (
        <div className={`card ${styles.tabPanel}`}>
          <form onSubmit={handleSingleSubmit} noValidate>
            <Field
              label="File PDF"
              htmlFor="single-file"
              required
              error={errors.file}
            >
              <input
                id="single-file"
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleFileChange}
              />
            </Field>

            <Field
              label="Chi nhánh"
              htmlFor="single-branch"
              required
              error={errors.branchId}
            >
              <select
                id="single-branch"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
              >
                <option value="">-- Chọn chi nhánh --</option>
                {branches.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Printer" htmlFor="single-printer">
              <input
                id="single-printer"
                type="text"
                value={printer}
                onChange={(e) => setPrinter(e.target.value)}
                placeholder="Tên máy in (tuỳ chọn)"
              />
            </Field>

            <Field
              label="User ID"
              htmlFor="single-userid"
              required
              error={errors.userId}
            >
              <input
                id="single-userid"
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="Nhập User ID"
              />
            </Field>

            <div className={styles.actions}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={singleLoading}
              >
                {singleLoading ? <Spinner size={16} /> : 'Tạo job'}
              </button>
            </div>
          </form>

          {/* Hiển thị kết quả sau khi tạo thành công */}
          {resultJobId && (
            <div className={styles.successBox}>
              Job đã tạo:{' '}
              <span className={styles.mono}>{resultJobId}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Tab hàng loạt ── */}
      {activeTab === 'bulk' && (
        <div className={`card ${styles.tabPanel}`}>
          <form onSubmit={handleBulkSubmit} noValidate>
            <Field
              label="File PDF (tối đa 20)"
              htmlFor="bulk-files"
              required
              error={fileError}
            >
              <input
                id="bulk-files"
                type="file"
                multiple
                accept=".pdf,application/pdf"
                onChange={handleBulkFileChange}
              />
            </Field>

            {/* Bảng thông tin từng file */}
            {files.length > 0 && (
              <div className={`table-wrapper ${styles.bulkTable}`}>
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Tên file</th>
                      <th>Chi nhánh *</th>
                      <th>Printer</th>
                      <th>User ID *</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((f, i) => (
                      <tr key={i}>
                        <td className={styles.numCell}>{i + 1}</td>
                        <td className={styles.nameCell}>{f.name}</td>
                        <td>
                          <select
                            value={items[i]?.branchId || ''}
                            onChange={(e) => updateItem(i, 'branchId', e.target.value)}
                            aria-label={`Chi nhánh cho file ${f.name}`}
                          >
                            <option value="">-- Chọn --</option>
                            {branches.map((b) => (
                              <option key={b.id} value={String(b.id)}>
                                {b.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="text"
                            value={items[i]?.printer || ''}
                            onChange={(e) => updateItem(i, 'printer', e.target.value)}
                            placeholder="Tuỳ chọn"
                            aria-label={`Printer cho file ${f.name}`}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={items[i]?.userId || ''}
                            onChange={(e) => updateItem(i, 'userId', e.target.value)}
                            placeholder="User ID"
                            aria-label={`User ID cho file ${f.name}`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className={styles.actions}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={bulkLoading || files.length === 0}
              >
                {bulkLoading ? <Spinner size={16} /> : `Tạo ${files.length} job`}
              </button>
            </div>
          </form>

          {/* Kết quả bulk create */}
          {bulkResult && (
            <div className={styles.bulkResult}>
              {/* Danh sách tạo thành công */}
              <div className={styles.resultSection}>
                <h3 className={styles.resultHeading}>
                  Thành công ({bulkResult.created?.length ?? 0})
                </h3>
                {bulkResult.created?.length > 0 && (
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th>Job ID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bulkResult.created.map((job, i) => (
                          <tr key={i}>
                            <td className={styles.mono}>
                              {job.id ?? job.job_id ?? JSON.stringify(job)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Danh sách thất bại */}
              {bulkResult.failed?.length > 0 && (
                <div className={styles.resultSection}>
                  <h3 className={`${styles.resultHeading} ${styles.failHeading}`}>
                    Thất bại ({bulkResult.failed.length})
                  </h3>
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Lỗi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bulkResult.failed.map((item, i) => (
                          <tr key={i}>
                            <td className={styles.numCell}>
                              {item.index ?? i + 1}
                            </td>
                            <td>{item.error ?? item.message ?? 'Không rõ lỗi'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

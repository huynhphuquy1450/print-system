import styles from './Pagination.module.css';

/**
 * @param {{ limit:number, offset:number, total:number, onChange:(newOffset:number)=>void }} props
 */
export default function Pagination({ limit, offset, total, onChange }) {
  const page = Math.floor(offset / limit);
  const pageCount = Math.ceil(total / limit);
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);

  function handleLimitChange(e) {
    const newLimit = Number(e.target.value);
    // Reset về đầu khi đổi limit — caller nên lắng nghe qua một callback riêng nếu cần
    // Tạm thời: emit offset=0 để trang reset
    onChange(0, newLimit);
  }

  return (
    <div className={styles.bar}>
      <span className={styles.info}>
        {from}–{to} / {total}
      </span>

      <div className={styles.controls}>
        <label className={styles.limitLabel}>
          Hiện
          <select
            value={limit}
            onChange={handleLimitChange}
            className={styles.limitSelect}
          >
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>

        <button
          className="btn btn-ghost"
          onClick={() => onChange(offset - limit)}
          disabled={page === 0}
        >
          ← Trước
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => onChange(offset + limit)}
          disabled={page >= pageCount - 1}
        >
          Sau →
        </button>
      </div>
    </div>
  );
}

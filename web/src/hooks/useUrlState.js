import { useSearchParams } from 'react-router-dom';

/**
 * Wrapper nhỏ gọn quanh useSearchParams cho các trang danh sách (filter/pagination).
 * - get(key, defaultValue): đọc 1 giá trị từ query string (dạng string).
 * - setMany(patch): gộp patch vào query hiện tại, xóa các key có giá trị
 *   '' / null / undefined, push history (replace: false) để Back hoạt động.
 */
export function useUrlState() {
  const [searchParams, setSearchParams] = useSearchParams();

  function get(key, defaultValue) {
    return searchParams.has(key) ? searchParams.get(key) : defaultValue;
  }

  function setMany(patch) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(patch)) {
          if (value === '' || value === null || value === undefined) {
            next.delete(key);
          } else {
            next.set(key, String(value));
          }
        }
        return next;
      },
      { replace: false }
    );
  }

  return { get, setMany };
}

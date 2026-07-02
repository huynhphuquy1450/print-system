import { listBranches } from './client.js';

// Cache cấp module: dedupe các lệnh gọi đồng thời (an toàn với StrictMode)
// và cache giá trị đã resolve để các trang khác không phải fetch lại.
let cachedPromise = null;
let cachedValue = null;

/** Trả về promise của danh sách chi nhánh (mảng branches). */
export function getBranches() {
  if (cachedValue !== null) {
    return Promise.resolve(cachedValue);
  }
  if (cachedPromise === null) {
    cachedPromise = listBranches()
      .then((res) => {
        const list = res?.branches || [];
        cachedValue = list;
        cachedPromise = null;
        return list;
      })
      .catch((err) => {
        cachedPromise = null;
        throw err;
      });
  }
  return cachedPromise;
}

/** Xóa cache để lần gọi getBranches() tiếp theo fetch lại từ server. */
export function invalidateBranches() {
  cachedPromise = null;
  cachedValue = null;
}

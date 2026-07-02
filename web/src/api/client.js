// Fetch wrapper gọi backend REST API
const BASE = import.meta.env.VITE_API_BASE_URL || '';

let authToken = null;
let unauthorizedHandler = () => {};

/** Cập nhật token xác thực cho mọi request tiếp theo */
export function setAuthToken(token) {
  authToken = token;
}

/** Đăng ký callback khi nhận 401 (thường là logout) */
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

/** Lỗi API có thêm status HTTP và payload từ server */
export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.error || payload?.message || `HTTP ${status}`);
    this.status = status;
    this.payload = payload;
  }
}

/**
 * Hàm fetch lõi.
 * @param {string} path - đường dẫn, VD '/api/v2/print-jobs'
 * @param {{ method?, query?, body?, form? }} options
 */
async function request(path, { method = 'GET', query, body, form } = {}) {
  // Xây query string, bỏ qua key undefined / null / chuỗi rỗng
  let qs = '';
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') {
        params.append(k, String(v));
      }
    }
    const str = params.toString();
    if (str) qs = '?' + str;
  }

  const headers = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  let fetchBody;
  if (form) {
    // FormData — để browser tự set Content-Type + boundary
    fetchBody = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(body);
  }

  const res = await fetch(BASE + path + qs, { method, headers, body: fetchBody });

  // 401 → gọi handler rồi throw
  if (res.status === 401) {
    unauthorizedHandler();
    throw new ApiError(401, null);
  }

  // Parse JSON an toàn
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    if (!res.ok) throw new ApiError(res.status, null);
    return null;
  }

  if (!res.ok) throw new ApiError(res.status, payload);
  return payload;
}

// ── Auth ──────────────────────────────────────────
export const login = (client_id, client_secret) =>
  request('/api/auth/login', { method: 'POST', body: { client_id, client_secret } });

export const me = () => request('/api/auth/me');

// ── Config (public) ───────────────────────────────
export const getConfig = () => request('/api/v1/config');

// ── Branches ──────────────────────────────────────
export const listBranches = () => request('/api/v1/branches');

export const updateBranch = (id, body) =>
  request(`/api/v1/branches/${id}`, { method: 'PATCH', body });

// ── Printers ──────────────────────────────────────
export const listPrinters = (branchId) =>
  request('/api/printers', { query: { branch_id: branchId } });

export const createPrinter = (body) =>
  request('/api/printers', { method: 'POST', body });

export const updatePrinter = (id, body) =>
  request(`/api/printers/${id}`, { method: 'PATCH', body });

export const deletePrinter = (id) =>
  request(`/api/printers/${id}`, { method: 'DELETE' });

// ── Print Jobs ────────────────────────────────────
/** @param {{ branch_id?, status?, from?, to?, limit?, offset? }} params */
export const listJobs = (params) =>
  request('/api/v2/print-jobs', { query: params });

export const retryJob = (id) =>
  request(`/api/v2/print-jobs/${id}/retry`, { method: 'POST' });

/** formData: multipart gồm pdf, branch_id, printer?, metadata (JSON string) */
export const createJob = (formData) =>
  request('/api/print-jobs', { method: 'POST', form: formData });

/** formData: multipart gồm nhiều 'pdf' + 'items' (JSON string) */
export const bulkCreate = (formData) =>
  request('/api/v2/print-jobs/bulk', { method: 'POST', form: formData });

// ── Audit Log ─────────────────────────────────────
/** @param {{ actor_id?, action?, from?, to?, limit?, offset? }} params */
export const listAudit = (params) =>
  request('/api/v2/audit-log', { query: params });

// ── Alerts ────────────────────────────────────────
/** @param {{ alert_type?, branch_id?, from?, to?, limit?, offset? }} params */
export const listAlerts = (params) =>
  request('/api/v2/alerts', { query: params });

export const deleteAlert = (id) =>
  request(`/api/v2/alerts/${id}`, { method: 'DELETE' });

// ── Clients ───────────────────────────────────────
export const listClients = () => request('/api/v2/clients');

export const createClient = (name) =>
  request('/api/v2/clients', { method: 'POST', body: { name } });

export const setClientActive = (id, is_active) =>
  request(`/api/v2/clients/${id}`, { method: 'PATCH', body: { is_active } });

export const rotateClientSecret = (id) =>
  request(`/api/v2/clients/${id}/rotate-secret`, { method: 'POST' });

// ── Webhooks ──────────────────────────────────────
export const listWebhooks = () => request('/api/v2/webhooks');

export const createWebhook = ({ url, events }) =>
  request('/api/v2/webhooks', { method: 'POST', body: { url, events } });

export const deleteWebhook = (id) =>
  request(`/api/v2/webhooks/${id}`, { method: 'DELETE' });

// Default export gom tất cả helper
const api = {
  login,
  me,
  getConfig,
  listBranches,
  updateBranch,
  listPrinters,
  createPrinter,
  updatePrinter,
  deletePrinter,
  listJobs,
  retryJob,
  createJob,
  bulkCreate,
  listAudit,
  listAlerts,
  deleteAlert,
  listClients,
  createClient,
  setClientActive,
  rotateClientSecret,
  listWebhooks,
  createWebhook,
  deleteWebhook,
};

export default api;

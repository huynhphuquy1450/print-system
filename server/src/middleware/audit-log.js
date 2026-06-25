'use strict';

const auditService = require('../services/audit-service');

// Thao tác ghi luôn được audit. GET chỉ audit khi handler đánh dấu `res.locals.audit`
// (vd tải PDF) — tránh phình bảng vì traffic đọc của dashboard.
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Middleware audit tự động (dạng lai): hook `res.on('finish')` để lấy who/ip/ua/
 * method/path/status chung. Handler có thể gắn `res.locals.audit = { action,
 * resource_type, resource_id, user_id }` để bổ sung dữ liệu chỉ có trong handler
 * (vd job_id sinh trong createJob, user_id trong metadata multipart).
 * Audit ghi fire-and-forget, lỗi nuốt trong audit-service — không bao giờ làm hỏng response.
 */
function auditLog(req, res, next) {
  res.on('finish', () => {
    try {
      const extra = res.locals.audit;
      const isWrite = WRITE_METHODS.has(req.method);
      if (!isWrite && !extra) return; // bỏ qua GET không nhạy cảm

      const actorType = req.client ? 'client' : req.agent ? 'agent' : 'anonymous';
      const actorId = (req.client && req.client.id) || (req.agent && req.agent.branchId) || null;

      auditService.record({
        at: Date.now(),
        actor_type: actorType,
        actor_id: actorId,
        user_id: (extra && extra.user_id) || null,
        action: (extra && extra.action) || `${req.method} ${req.path}`,
        resource_type: (extra && extra.resource_type) || null,
        resource_id: (extra && extra.resource_id) || null,
        method: req.method,
        path: req.path,
        status_code: res.statusCode,
        ip: req.ip,
        user_agent: req.headers['user-agent'] || null,
      });
    } catch (_e) {
      // không bao giờ để audit làm hỏng vòng đời response
    }
  });
  next();
}

module.exports = { auditLog };

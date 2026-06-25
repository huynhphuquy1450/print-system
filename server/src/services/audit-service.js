'use strict';

const { stmts } = require('../db');
const logger = require('../logger');

/**
 * Ghi một dòng audit log. Khác `cleanup-audit.js`: hàm này chạy NGOÀI transaction
 * (audit là phụ trợ, không được làm hỏng request chính). Mọi lỗi DB được nuốt + log,
 * không ném ra ngoài — caller (middleware) gọi fire-and-forget sau khi response đã gửi.
 *
 * @param {object} entry
 * @param {number} [entry.at] ms epoch; mặc định Date.now()
 * @param {string} [entry.actor_type] 'client' | 'agent' | 'anonymous'
 * @param {string} [entry.actor_id] client_id hoặc branch_id
 * @param {string} [entry.user_id] metadata.user_id (vd khi tạo job)
 * @param {string} entry.action bắt buộc — 'job.create' | 'auth.login' | ...
 * @param {string} [entry.resource_type] 'job' | 'branch' | ...
 * @param {string} [entry.resource_id]
 * @param {string} [entry.method] HTTP method
 * @param {string} [entry.path] HTTP path
 * @param {number} [entry.status_code]
 * @param {string} [entry.ip]
 * @param {string} [entry.user_agent]
 */
async function record(entry) {
  try {
    await stmts.insertAudit.run({
      at: entry.at || Date.now(),
      actor_type: entry.actor_type || null,
      actor_id: entry.actor_id || null,
      user_id: entry.user_id || null,
      action: entry.action,
      resource_type: entry.resource_type || null,
      resource_id: entry.resource_id || null,
      method: entry.method || null,
      path: entry.path || null,
      status_code: entry.status_code == null ? null : entry.status_code,
      ip: entry.ip || null,
      user_agent: entry.user_agent || null,
    });
  } catch (e) {
    logger.error('Failed to record audit log', { err: e.message, action: entry.action });
  }
}

module.exports = { record };

'use strict';

const { db, stmts } = require('../db');
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

/**
 * Đọc audit log cho HQ (HM3): filter theo actor/action/khoảng thời gian + pagination.
 * Tham số filter qua placeholder ($N) — không nối chuỗi. Returns: { entries, total, limit, offset }
 */
async function list({ clientId, actorId, action, from, to, limit = 50, offset = 0 } = {}) {
  if (!clientId) throw new Error('list() requires clientId for tenant scoping');
  const where = [];
  const params = [];
  // Tenant isolation: client chỉ thấy audit của CHÍNH mình + của các branch thuộc client đó
  // (actor_id của agent là branch_id). audit_log không có cột client_id nên scope qua branches.
  params.push(clientId);
  where.push(
    `(actor_id = $${params.length} OR actor_id IN (SELECT id FROM branches WHERE client_id = $${params.length}))`
  );
  if (actorId) { params.push(actorId); where.push(`actor_id = $${params.length}`); }
  if (action) { params.push(action); where.push(`action = $${params.length}`); }
  if (from != null) { params.push(from); where.push(`at >= $${params.length}`); }
  if (to != null) { params.push(to); where.push(`at <= $${params.length}`); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const off = Math.max(parseInt(offset, 10) || 0, 0);

  const totalRes = await db.query(`SELECT COUNT(*) AS total FROM audit_log ${whereSql}`, params);
  const total = Number(totalRes.rows[0].total);

  const pageParams = params.concat([lim, off]);
  const rows = await db.query(
    `SELECT * FROM audit_log ${whereSql} ORDER BY at DESC LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
    pageParams
  );
  return { entries: rows.rows, total, limit: lim, offset: off };
}

module.exports = { record, list };

'use strict';

const { db, stmts } = require('../db');
const logger = require('../logger');
const webhookService = require('./webhook-service');

/**
 * TASK 7: ghi 1 dòng audit vào bảng alerts (LUÔN ghi, kể cả client_id null) rồi bắn webhook
 * 'alert' fire-and-forget. Dùng chung cho cron mark-offline và heartbeat printer/branch.
 */
async function emit({ clientId, branchId, printerId = null, alertType, status }) {
  const at = Date.now();
  try {
    await stmts.insertAlert.run({
      client_id: clientId || null,
      branch_id: branchId || null,
      printer_id: printerId,
      alert_type: alertType,
      status: status || null,
      created_at: at,
    });
  } catch (e) {
    logger.error('Alert insert error', { err: e.message, alert_type: alertType });
  }
  webhookService.dispatchAlert({ clientId, alertType, branchId, printerId, status }).catch(() => {});
}

async function list({ clientId, alertType, branchId, from, to, limit = 50, offset = 0 } = {}) {
  if (!clientId) throw new Error('list() requires clientId for tenant scoping');
  const where = [];
  const params = [];
  // Tenant isolation: alert của chính client HOẶC của branch thuộc client (bắt cả client_id null).
  params.push(clientId);
  where.push(
    `(client_id = $${params.length} OR branch_id IN (SELECT id FROM branches WHERE client_id = $${params.length}))`
  );
  if (alertType) { params.push(alertType); where.push(`alert_type = $${params.length}`); }
  if (branchId) { params.push(branchId); where.push(`branch_id = $${params.length}`); }
  if (from != null) { params.push(from); where.push(`created_at >= $${params.length}`); }
  if (to != null) { params.push(to); where.push(`created_at <= $${params.length}`); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const off = Math.max(parseInt(offset, 10) || 0, 0);

  const totalRes = await db.query(`SELECT COUNT(*) AS total FROM alerts ${whereSql}`, params);
  const total = Number(totalRes.rows[0].total);

  const pageParams = params.concat([lim, off]);
  const rows = await db.query(
    `SELECT * FROM alerts ${whereSql} ORDER BY created_at DESC LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
    pageParams
  );
  return { alerts: rows.rows, total, limit: lim, offset: off };
}

module.exports = { emit, list };

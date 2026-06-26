'use strict';

const { stmts } = require('../db');
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

module.exports = { emit };

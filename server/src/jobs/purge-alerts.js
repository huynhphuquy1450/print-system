'use strict';

const config = require('../config');
const logger = require('../logger');
const { stmts } = require('../db');

let lastRunDate = null;
let checkInterval = null;

/**
 * Cron retention cho alerts: mỗi giờ kiểm tra; nếu đúng CLEANUP_HOUR thì xóa
 * các dòng cũ hơn ALERTS_RETENTION_DAYS, 1 lần/ngày. Cùng pattern với cleanup-files.js
 * (gate giờ + lastRunDate), nhưng đơn giản hơn — chỉ 1 câu DELETE, không có file/transaction.
 */
async function run() {
 try {
 if (config.alerts.retentionDays <= 0) return;
 const now = new Date();
 if (now.getHours() !== config.cron.cleanupHour) return;
 const todayKey = now.toISOString().slice(0, 10);
 if (lastRunDate === todayKey) return;
 lastRunDate = todayKey;

 const cutoffMs = Date.now() - config.alerts.retentionDays * 24 * 60 * 60 * 1000;
 const r = await stmts.deleteAlertsOlderThan.run({ cutoff: cutoffMs });

 logger.info('Alerts purge completed', {
 rows_deleted: r.rowCount,
 retention_days: config.alerts.retentionDays,
 });
 } catch (e) {
 logger.error('Alerts purge error', { err: e.message });
 }
}

function start() {
 if (checkInterval) return;
 checkInterval = setInterval(run, 60 * 60 * 1000);
 logger.info('Alerts purge job started', {
 check_interval: '1h',
 run_at_hour: config.cron.cleanupHour,
 retention_days: config.alerts.retentionDays,
 });
}

function stop() {
 if (checkInterval) {
 clearInterval(checkInterval);
 checkInterval = null;
 logger.info('Alerts purge job stopped');
 }
}

module.exports = { start, stop, run };

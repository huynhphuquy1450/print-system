'use strict';

const config = require('../config');
const logger = require('../logger');
const { db } = require('../db');

let lastRunDate = null;
let checkInterval = null;

/**
 * Cron retention cho audit_log: mỗi giờ kiểm tra; nếu đúng CLEANUP_HOUR thì MOVE các dòng cũ hơn
 * AUDIT_RETENTION_DAYS sang audit_log_archive (giữ lịch sử mãi), 1 lần/ngày. Cùng pattern gate giờ +
 * lastRunDate với cleanup-files.js. Archive + delete chạy trong 1 transaction (cùng cutoff) nên
 * atomic — fail thì rollback, không mất/không nhân đôi. AUDIT_RETENTION_DAYS <= 0 = tắt move.
 */
async function run() {
 try {
 if (config.audit.retentionDays <= 0) return;
 const now = new Date();
 if (now.getHours() !== config.cron.cleanupHour) return;
 const todayKey = now.toISOString().slice(0, 10);
 if (lastRunDate === todayKey) return;
 lastRunDate = todayKey;

 const cutoffMs = Date.now() - config.audit.retentionDays * 24 * 60 * 60 * 1000;
 const moved = await db.transaction(async (tx) => {
 await tx.stmts.archiveOldAuditLogs.run({ cutoff: cutoffMs, archived_at: Date.now() });
 const r = await tx.stmts.deleteOldAuditLogs.run({ cutoff: cutoffMs });
 return r.rowCount;
 });

 logger.info('Audit log archive completed', {
 rows_moved: moved,
 retention_days: config.audit.retentionDays,
 });
 } catch (e) {
 logger.error('Audit log purge error', { err: e.message });
 }
}

function start() {
 if (checkInterval) return;
 checkInterval = setInterval(run, 60 * 60 * 1000);
 logger.info('Audit log purge job started', {
 check_interval: '1h',
 run_at_hour: config.cron.cleanupHour,
 retention_days: config.audit.retentionDays,
 });
}

function stop() {
 if (checkInterval) {
 clearInterval(checkInterval);
 checkInterval = null;
 logger.info('Audit log purge job stopped');
 }
}

module.exports = { start, stop, run };

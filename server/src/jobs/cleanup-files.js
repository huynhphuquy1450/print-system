'use strict';

const fs = require('fs');
const config = require('../config');
const logger = require('../logger');
const { db, stmts } = require('../db');
const audit = require('../services/cleanup-audit');

let lastRunDate = null;
let checkInterval = null;

// Audit + job delete trong 1 transaction: nếu audit throw, delete roll back.
const deleteOneJob = db.transaction((job, reason, sizeBytes) => {
 audit.record(db, {
 job_id: job.id,
 file_path: job.file_path,
 branch_id: job.branch_id,
 reason,
 size_bytes: sizeBytes,
 });
 stmts.deleteJobById.run(job.id);
});

function run() {
 try {
 const now = new Date();
 const hour = now.getHours();
 // Chỉ chạy đúng giờ CLEANUP_HOUR, 1 lần/ngày
 if (hour !== config.cron.cleanupHour) return;
 const todayKey = now.toISOString().slice(0, 10);
 if (lastRunDate === todayKey) return;
 lastRunDate = todayKey;

 const cutoffMs = Date.now() - config.storage.retentionDays * 24 * 60 * 60 * 1000;

 // 1. Tìm job rows printed/failed cũ
 const oldJobs = stmts.findOldJobs.all(cutoffMs);

 if (oldJobs.length === 0) {
 logger.info('Cleanup: no old jobs to remove');
 return;
 }

 let deleted = 0;
 let filesDeleted = 0;
 for (const job of oldJobs) {
 // Capture size trước khi xóa file (best-effort; missing → reason=file-missing)
 let sizeBytes = null;
 let fileExisted = false;
 try {
 if (fs.existsSync(job.file_path)) {
 sizeBytes = fs.statSync(job.file_path).size;
 fs.unlinkSync(job.file_path);
 fileExisted = true;
 filesDeleted++;
 }
 } catch (e) {
 logger.warn('Failed to delete PDF', { file: job.file_path, err: e.message });
 }
 const reason = fileExisted ? 'retention' : 'file-missing';
 try {
 deleteOneJob(job, reason, sizeBytes);
 deleted++;
 } catch (e) {
 // Transaction tự rollback — job row vẫn còn, retry lần sau.
 logger.error('Cleanup audit/transaction failed; row kept', {
 job_id: job.id,
 err: e.message,
 });
 }
 }

 logger.info('Cleanup completed', {
 jobs_deleted: deleted,
 files_deleted: filesDeleted,
 retention_days: config.storage.retentionDays,
 });
 } catch (e) {
 logger.error('Cleanup error', { err: e.message });
 }
}

function start() {
 if (checkInterval) return;
 // Check mỗi giờ
 checkInterval = setInterval(run, 60 * 60 * 1000);
 logger.info('Cleanup job started', {
 check_interval: '1h',
 run_at_hour: config.cron.cleanupHour,
 retention_days: config.storage.retentionDays,
 });
}

function stop() {
 if (checkInterval) {
 clearInterval(checkInterval);
 checkInterval = null;
 logger.info('Cleanup job stopped');
 }
}

module.exports = { start, stop, run };

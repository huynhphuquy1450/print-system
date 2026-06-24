'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const config = require('../config');
const logger = require('../logger');

let lastRunDate = null;
let checkInterval = null;

/**
 * Cron: mỗi giờ kiểm tra; nếu đúng BACKUP_HOUR thì gọi pg_dump để tạo
 * backup SQL ở DB_BACKUPS_DIR. Giữ lại DB_BACKUP_RETENTION_DAYS ngày.
 *
 * pg_dump được gọi như một subprocess (execFile, không phải shell) để tránh
 * shell injection từ DATABASE_URL. pg_dump phải có trong PATH của production.
 */
async function run() {
 try {
 const now = new Date();
 const hour = now.getHours();
 if (hour !== config.cron.backupHour) return;
 const todayKey = now.toISOString().slice(0, 10);
 if (lastRunDate === todayKey) return;
 lastRunDate = todayKey;

 if (!process.env.DATABASE_URL) {
 logger.error('Backup skipped: DATABASE_URL not set');
 return;
 }

 const backupsDir = path.resolve(__dirname, '..', '..', config.db.backupsDir);
 fs.mkdirSync(backupsDir, { recursive: true });

 const today = new Date().toISOString().slice(0, 10);
 const backupPath = path.join(backupsDir, `jobs-${today}.sql`);

 // pg_dump: --no-owner (no ALTER OWNER), --clean (DROP before CREATE),
 // --if-exists (silent DROP), --no-privileges (skip GRANTs).
 await new Promise((resolve, reject) => {
 execFile(
 'pg_dump',
 [
 process.env.DATABASE_URL,
 '--no-owner',
 '--clean',
 '--if-exists',
 '--no-privileges',
 '-f', backupPath,
 ],
 (err, _stdout, stderr) => {
 if (err) {
 logger.error('pg_dump failed', { err: err.message, stderr });
 return reject(err);
 }
 resolve();
 }
 );
 });

 // Verify file size > 0
 const stat = fs.statSync(backupPath);
 if (stat.size === 0) {
 throw new Error('Backup file is empty');
 }
 logger.info('DB backup created', { path: backupPath, size_kb: Math.round(stat.size / 1024) });

 // Xóa backup cũ hơn retention
 const cutoffMs = Date.now() - config.db.retentionBackupsDays * 24 * 60 * 60 * 1000;
 const files = fs.readdirSync(backupsDir);
 let removed = 0;
 for (const f of files) {
 if (!f.startsWith('jobs-') || !f.endsWith('.sql')) continue;
 const full = path.join(backupsDir, f);
 const fstat = fs.statSync(full);
 if (fstat.mtimeMs < cutoffMs) {
 fs.unlinkSync(full);
 removed++;
 }
 }
 if (removed > 0) {
 logger.info('Old backups removed', { count: removed });
 }
 } catch (e) {
 logger.error('Backup error', { err: e.message });
 }
}

function start() {
 if (checkInterval) return;
 checkInterval = setInterval(run, 60 * 60 * 1000);
 logger.info('Backup job started', {
 check_interval: '1h',
 run_at_hour: config.cron.backupHour,
 retention_days: config.db.retentionBackupsDays,
 });
}

function stop() {
 if (checkInterval) {
 clearInterval(checkInterval);
 checkInterval = null;
 logger.info('Backup job stopped');
 }
}

module.exports = { start, stop, run };
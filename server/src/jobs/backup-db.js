'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../logger');
const { db } = require('../db');

let lastRunDate = null;
let checkInterval = null;

function run() {
  try {
    const now = new Date();
    const hour = now.getHours();
    if (hour !== config.cron.backupHour) return;
    const todayKey = now.toISOString().slice(0, 10);
    if (lastRunDate === todayKey) return;
    lastRunDate = todayKey;

    const dbPath = path.resolve(__dirname, '..', '..', config.db.path);
    const backupsDir = path.resolve(__dirname, '..', '..', config.db.backupsDir);
    fs.mkdirSync(backupsDir, { recursive: true });

    const today = new Date().toISOString().slice(0, 10);
    const backupPath = path.join(backupsDir, `jobs-${today}.db`);

    // Dùng SQLite VACUUM INTO (safer than file copy vì đang write)
    db.exec(`VACUUM INTO '${backupPath}'`);

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
      if (!f.startsWith('jobs-') || !f.endsWith('.db')) continue;
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
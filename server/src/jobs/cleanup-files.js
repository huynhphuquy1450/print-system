'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../logger');
const { stmts } = require('../db');

let lastRunDate = null;
let checkInterval = null;

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
    const oldJobs = stmts.db
      .prepare(`SELECT id, file_path FROM jobs WHERE status IN ('printed', 'failed') AND created_at < ?`)
      .all(cutoffMs);

    if (oldJobs.length === 0) {
      logger.info('Cleanup: no old jobs to remove');
      return;
    }

    let deleted = 0;
    let filesDeleted = 0;
    for (const job of oldJobs) {
      // Xóa file PDF
      try {
        if (fs.existsSync(job.file_path)) {
          fs.unlinkSync(job.file_path);
          filesDeleted++;
        }
      } catch (e) {
        logger.warn('Failed to delete PDF', { file: job.file_path, err: e.message });
      }
      // Xóa row
      stmts.db.prepare(`DELETE FROM jobs WHERE id = ?`).run(job.id);
      deleted++;
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
'use strict';

const config = require('../config');
const logger = require('../logger');
const { stmts } = require('../db');
const mqttClient = require('../mqtt-client');
const fs = require('fs');

let interval = null;
let running = false;

/**
 * Cron: mỗi RETRY_INTERVAL_MIN phút, tìm job status='sent' quá STALE_JOB_MIN
 * chưa có callback → republish. Nếu retry_count >= MAX_RETRIES → mark failed.
 */
async function run() {
  if (running) return;
  running = true;

  try {
    if (!mqttClient.isConnected()) {
      logger.debug('Retry skipped: MQTT not connected');
      return;
    }

    const cutoff = Date.now() - config.cron.staleJobMin * 60 * 1000;
    const staleJobs = stmts.findStaleJobs.all({
      cutoff,
      max_retries: config.cron.maxRetries,
    });

    if (staleJobs.length === 0) {
      logger.debug('No stale jobs to retry');
      return;
    }

    logger.info('Found stale jobs to retry', { count: staleJobs.length });

    for (const job of staleJobs) {
      // Đọc file PDF → base64 để republish
      let pdfBase64;
      try {
        pdfBase64 = fs.readFileSync(job.file_path).toString('base64');
      } catch (e) {
        logger.error('Cannot read PDF for retry', { job_id: job.id, err: e.message });
        stmts.markJobFailed.run({
          failed_at: Date.now(),
          error: `PDF file missing: ${e.message}`,
          id: job.id,
        });
        continue;
      }

      let metadata = {};
      try { metadata = JSON.parse(job.metadata || '{}'); } catch (e) {}

      try {
        await mqttClient.publishJob(job.branch_id, {
          job_id: job.id,
          pdf_base64: pdfBase64,
          printer: job.printer,
          metadata,
          retry_count: job.retry_count + 1,
          created_at: Date.now(),
        });
        stmts.incrementRetry.run({ id: job.id });
        stmts.markJobSent.run({ sent_at: Date.now(), id: job.id });
        logger.info('Job republished', { job_id: job.id, retry: job.retry_count + 1 });
      } catch (e) {
        logger.error('Republish failed', { job_id: job.id, err: e.message });
        stmts.incrementRetry.run({ id: job.id });
        if (job.retry_count + 1 >= config.cron.maxRetries) {
          stmts.markJobFailed.run({
            failed_at: Date.now(),
            error: `Max retries reached: ${e.message}`,
            id: job.id,
          });
          logger.warn('Job failed after max retries', { job_id: job.id });
        }
      }
    }
  } catch (e) {
    logger.error('Retry-stale job error', { err: e.message });
  } finally {
    running = false;
  }
}

function start() {
  if (interval) return;
  const ms = config.cron.retryIntervalMin * 60 * 1000;
  interval = setInterval(run, ms);
  logger.info('Retry-stale job started', { interval_min: config.cron.retryIntervalMin });
  // Chạy 1 lần ngay khi start
  setTimeout(run, 5000);
}

function stop() {
  if (interval) {
    clearInterval(interval);
    interval = null;
    logger.info('Retry-stale job stopped');
  }
}

module.exports = { start, stop, run };
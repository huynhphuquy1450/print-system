'use strict';

const config = require('../config');
const logger = require('../logger');
const { stmts } = require('../db');

let interval = null;
let running = false;

/**
 * Cron (TASK 6): mỗi PRESENCE_CHECK_INTERVAL_MS, hạ branches/printers có last_seen_at
 * quá PRESENCE_OFFLINE_MS về status='offline' → cột status thành nguồn sự thật cho cảnh báo.
 */
async function run() {
 if (running) return;
 running = true;

 try {
 const cutoff = Date.now() - config.presence.offlineMs;
 const br = await stmts.markOfflineBranches.run({ cutoff });
 const pr = await stmts.markOfflinePrinters.run({ cutoff });
 if (br.rowCount > 0 || pr.rowCount > 0) {
 logger.info('Marked stale stations offline', {
 branches: br.rowCount,
 printers: pr.rowCount,
 offline_ms: config.presence.offlineMs,
 });
 }
 } catch (e) {
 logger.error('Mark-offline job error', { err: e.message });
 } finally {
 running = false;
 }
}

function start() {
 if (interval) return;
 interval = setInterval(run, config.presence.checkIntervalMs);
 logger.info('Mark-offline job started', {
 interval_ms: config.presence.checkIntervalMs,
 offline_ms: config.presence.offlineMs,
 });
 // Chạy 1 lần ngay sau khi start (giống retry-stale)
 setTimeout(run, 5000);
}

function stop() {
 if (interval) {
 clearInterval(interval);
 interval = null;
 logger.info('Mark-offline job stopped');
 }
}

module.exports = { start, stop, run };

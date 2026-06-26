'use strict';

const config = require('../config');
const logger = require('../logger');
const { stmts } = require('../db');
const alertService = require('../services/alert-service');

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
 // Dùng .all() để lấy danh sách rows flip offline → bắn alert từng row
 const brRows = await stmts.markOfflineBranches.all({ cutoff });
 const prRows = await stmts.markOfflinePrinters.all({ cutoff });
 for (const b of brRows) {
 await alertService.emit({ clientId: b.client_id, branchId: b.id, alertType: 'branch.offline', status: 'offline' });
 }
 for (const p of prRows) {
 const branch = await stmts.getBranchById.get(p.branch_id);
 await alertService.emit({ clientId: branch ? branch.client_id : null, branchId: p.branch_id, printerId: p.id, alertType: 'printer.offline', status: 'offline' });
 }
 if (brRows.length > 0 || prRows.length > 0) {
 logger.info('Marked stale stations offline', {
 branches: brRows.length,
 printers: prRows.length,
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

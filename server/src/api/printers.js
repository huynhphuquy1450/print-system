'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { stmts, db } = require('../db');
const { verifyClient, verifyAgent } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const alertService = require('../services/alert-service');

/**
 * GET /api/printers?branch_id=X (Client JWT) - list printers of branch
 */
router.get('/', verifyClient, async (req, res, next) => {
 try {
 const branchId = req.query.branch_id;
 if (!branchId) {
 return res.status(400).json({ error: 'branch_id query param is required' });
 }
 const printers = await stmts.listPrintersByBranch.all(branchId);
 res.json({ printers });
 } catch (e) { next(e); }
});

/**
 * POST /api/printers (Client JWT) - tạo printer
 * Body: { id?, branch_id, name, is_default? }
 */
router.post(
 '/',
 verifyClient,
 validate({
 branch_id: { required: true, type: 'string' },
 name: { required: true, type: 'string', minLength: 1, maxLength: 100 },
 is_default: { type: 'number' },
 }),
 async (req, res, next) => {
 try {
 const { branch_id, name } = req.body;
 // Check branch exists
 const branch = await stmts.getBranchById.get(branch_id);
 if (!branch) return res.status(404).json({ error: `Branch '${branch_id}' not found` });

 const id = req.body.id || `prn_${crypto.randomBytes(4).toString('hex')}`;
 const isDefault = req.body.is_default ? 1 : 0;

 // Nếu set default, unset các default khác
 if (isDefault) {
 const existing = await stmts.listPrintersByBranch.all(branch_id);
 for (const p of existing) {
 if (p.is_default) {
 // FIX: original code called `stmts.db.exec(...)` which is undefined
 // (stmts is an object of prepared statements, not the db instance).
 // Use db.query() directly with parameterized SQL.
 await db.query('UPDATE printers SET is_default = 0 WHERE id = $1', [p.id]);
 }
 }
 }

 try {
 await stmts.insertPrinter.run({
 id,
 branch_id,
 name,
 is_default: isDefault,
 source: 'manual',
 approved: 1,
 created_at: Date.now(),
 });
 } catch (e) {
 // PostgreSQL error code 23505 = unique_violation
 if (e.code === '23505') {
 return res.status(409).json({ error: `Printer '${id}' already exists` });
 }
 throw e;
 }

 res.status(201).json({ id, branch_id, name, is_default: isDefault, source: 'manual', approved: 1 });
 } catch (e) { next(e); }
 }
);

const VALID_STATUSES = new Set(['online', 'out_of_paper', 'paper_jam', 'offline', 'unknown']);

/**
 * POST /api/printers/heartbeat (Agent token) - cập nhật trạng thái máy in từ agent
 * Body: { printers: [ { name: string, status: enum } ] }
 */
router.post('/heartbeat', verifyAgent, async (req, res, next) => {
 try {
 const { printers } = req.body || {};
 if (!Array.isArray(printers)) {
 return res.status(400).json({ error: 'printers must be an array' });
 }
 let updated = 0;
 let discovered = 0;
 for (const item of printers) {
 const { name, status } = item || {};
 if (typeof name !== 'string' || name.length === 0 || !VALID_STATUSES.has(status)) {
 continue;
 }
 // Đọc trạng thái cũ trước khi update để phát hiện thay đổi cần alert
 const before = await stmts.getPrinterByBranchAndName.get({ branch_id: req.agent.branchId, name });
 const now = Date.now();
 const result = await stmts.updatePrinterStatus.run({
 status,
 last_seen_at: now,
 branch_id: req.agent.branchId,
 name,
 });
 if (result.rowCount > 0) {
 updated += result.rowCount;
 const oldStatus = before ? before.status : null;
 if (oldStatus !== status) {
 if (status === 'out_of_paper' || status === 'paper_jam') {
 // Máy in gặp sự cố → bắn alert lỗi, fire-and-forget
 alertService.emit({ clientId: req.agent.clientId, branchId: req.agent.branchId, printerId: before && before.id, alertType: 'printer.' + status, status }).catch(() => {});
 } else if (status === 'online' && (oldStatus === 'offline' || oldStatus === 'out_of_paper' || oldStatus === 'paper_jam')) {
 // Máy in phục hồi → bắn alert recovery
 alertService.emit({ clientId: req.agent.clientId, branchId: req.agent.branchId, printerId: before && before.id, alertType: 'printer.online', status: 'online' }).catch(() => {});
 }
 }
 } else {
 await stmts.insertDiscoveredPrinter.run({
 id: `prn_${crypto.randomBytes(4).toString('hex')}`,
 branch_id: req.agent.branchId,
 name,
 status,
 last_seen_at: now,
 created_at: now,
 });
 discovered += 1;
 }
 }
 res.json({ ok: true, updated, discovered });
 } catch (e) { next(e); }
});

/**
 * PATCH /api/printers/:id (Client JWT) - duyệt hoặc đặt mặc định
 * Body: { is_default?: number, approved?: number }
 */
router.patch('/:id', verifyClient, async (req, res, next) => {
 try {
 const printer = await stmts.getPrinterById.get(req.params.id);
 if (!printer) return res.status(404).json({ error: 'Printer not found' });

 const { is_default, approved } = req.body || {};

 if (is_default !== undefined) {
 if (typeof is_default !== 'number') {
 return res.status(400).json({ error: "Field 'is_default' must be a number" });
 }
 if (is_default) {
 const existing = await stmts.listPrintersByBranch.all(printer.branch_id);
 for (const p of existing) {
 if (p.is_default && p.id !== printer.id) {
 await db.query('UPDATE printers SET is_default = 0 WHERE id = $1', [p.id]);
 }
 }
 }
 await stmts.setPrinterDefault.run({ id: printer.id, is_default: is_default ? 1 : 0 });
 }

 if (approved !== undefined) {
 if (typeof approved !== 'number') {
 return res.status(400).json({ error: "Field 'approved' must be a number" });
 }
 await stmts.setPrinterApproved.run({ id: printer.id, approved: approved ? 1 : 0 });
 }

 const result = await stmts.getPrinterById.get(printer.id);
 res.json(result);
 } catch (e) { next(e); }
});

/**
 * DELETE /api/printers/:id (Client JWT)
 */
router.delete('/:id', verifyClient, async (req, res, next) => {
 try {
 const printer = await stmts.getPrinterById.get(req.params.id);
 if (!printer) return res.status(404).json({ error: 'Printer not found' });
 await stmts.deletePrinter.run(req.params.id);
 res.json({ ok: true });
 } catch (e) { next(e); }
});

module.exports = router;
'use strict';

const express = require('express');
const router = express.Router();
const { stmts } = require('../db');
const { verifyClient } = require('../middleware/auth');
const { generateAgentToken, hashAgentToken } = require('../services/token-service');
const { validate } = require('../middleware/validate');

/**
 * GET /api/branches (Client JWT) - list
 */
router.get('/', verifyClient, async (req, res, next) => {
 try {
 const rows = await stmts.listAllBranches.all();
 const branches = rows.map((b) => ({
 id: b.id,
 name: b.name,
 location: b.location,
 status: b.status,
 last_seen_at: b.last_seen_at,
 created_at: b.created_at,
 // KHÔNG trả agent_token_hash ra ngoài
 }));
 res.json({ branches });
 } catch (e) { next(e); }
});

/**
 * POST /api/branches (Client JWT) - tạo mới
 * Body: { id?, name, location? }
 * Returns: { id, name, location, agent_token (plaintext, 1 lần duy nhất) */
router.post(
 '/',
 verifyClient,
 validate({
 name: { required: true, type: 'string', minLength: 1, maxLength: 100 },
 location: { type: 'string' },
 }),
 async (req, res, next) => {
 try {
 const { name, location } = req.body;
 const id = req.body.id || `br_${String(Date.now()).slice(-6)}`;
 const token = generateAgentToken();
 const tokenHash = hashAgentToken(token);

 try {
 await stmts.insertBranch.run({
 id,
 name,
 location: location || null,
 client_id: req.client.id,
 agent_token_hash: tokenHash,
 created_at: Date.now(),
 });
 } catch (e) {
 // PostgreSQL error code 23505 = unique_violation
 if (e.code === '23505') {
 return res.status(409).json({ error: `Branch '${id}' already exists` });
 }
 throw e;
 }

 res.locals.audit = { action: 'branch.create', resource_type: 'branch', resource_id: id };
 res.status(201).json({
 id,
 name,
 location: location || null,
 agent_token: token, // CHỈ trả plaintext 1 lần này
 });
 } catch (e) { next(e); }
 }
);

/**
 * GET /api/branches/:id (Client JWT) - chi tiết
 */
router.get('/:id', verifyClient, async (req, res, next) => {
 try {
 const branch = await stmts.getBranchById.get(req.params.id);
 if (!branch) return res.status(404).json({ error: 'Branch not found' });
 // Strip token hash
 delete branch.agent_token_hash;
 res.json(branch);
 } catch (e) { next(e); }
});

/**
 * POST /api/branches/:id/regen-token (Client JWT) - rotate agent token
 * Returns: { id, agent_token (mới) }
 */
router.post('/:id/regen-token', verifyClient, async (req, res, next) => {
 try {
 const branch = await stmts.getBranchById.get(req.params.id);
 if (!branch) return res.status(404).json({ error: 'Branch not found' });

 // Audit: rotate agent token là sự kiện bảo mật — ghi rõ branch nào
 res.locals.audit = { action: 'branch.regen_token', resource_type: 'branch', resource_id: branch.id };

 const newToken = generateAgentToken();
 await stmts.updateBranchToken.run({
 agent_token_hash: hashAgentToken(newToken),
 id: branch.id,
 });

 res.json({
 id: branch.id,
 name: branch.name,
 agent_token: newToken, // Token mới - a copy cho agent update
 warning: 'Old token đã bị vô hiệu. Cập nhật agent .env ngay.',
 });
 } catch (e) { next(e); }
});

/**
 * PATCH /api/branches/:id (Client JWT) - đổi tên / location
 * Chỉ client chủ branch mới được sửa. Body: { name?, location? }
 */
router.patch('/:id', verifyClient, validate({
 name: { type: 'string', minLength: 1, maxLength: 100 },
 location: { type: 'string' },
}), async (req, res, next) => {
 try {
 const branch = await stmts.getBranchById.get(req.params.id);
 if (!branch) return res.status(404).json({ error: 'Branch not found' });
 if (req.body.name === undefined && req.body.location === undefined) {
 return res.status(400).json({ error: 'Cần ít nhất name hoặc location' });
 }
 res.locals.audit = { action: 'branch.update', resource_type: 'branch', resource_id: branch.id };

 const name = req.body.name !== undefined ? req.body.name : branch.name;
 const location = req.body.location !== undefined ? req.body.location : branch.location;
 try {
 await stmts.updateBranch.run({ id: branch.id, name, location });
 } catch (e) {
 if (e.code === '23505') {
 return res.status(409).json({ error: `Tên trạm '${name}' đã tồn tại trong client của bạn` });
 }
 throw e;
 }
 res.json({ id: branch.id, name, location });
 } catch (e) { next(e); }
});

/**
 * POST /api/branches/:id/transfer-client (Client JWT) - gán branch sang client khác
 * Chỉ client chủ branch hiện tại mới được chuyển. Body: { target_client_id }
 */
router.post('/:id/transfer-client', verifyClient, validate({
 target_client_id: { required: true, type: 'string', minLength: 1 },
}), async (req, res, next) => {
 try {
 const branch = await stmts.getBranchById.get(req.params.id);
 if (!branch) return res.status(404).json({ error: 'Branch not found' });

 const targetId = req.body.target_client_id;
 if (targetId === branch.client_id) {
 return res.status(400).json({ error: 'Trạm đã thuộc client này' });
 }
 const target = await stmts.getClientById.get(targetId);
 if (!target) return res.status(404).json({ error: 'Client đích không tồn tại' });
 if (target.is_active === 0) return res.status(400).json({ error: 'Client đích không hoạt động' });

 res.locals.audit = { action: 'branch.transfer_client', resource_type: 'branch', resource_id: branch.id };

 try {
 await stmts.updateBranchClient.run({ id: branch.id, client_id: targetId });
 } catch (e) {
 if (e.code === '23505') {
 return res.status(409).json({ error: `Tên trạm '${branch.name}' đã tồn tại trong client đích` });
 }
 throw e;
 }
 res.json({ id: branch.id, name: branch.name, client_id: targetId });
 } catch (e) { next(e); }
});

module.exports = router;
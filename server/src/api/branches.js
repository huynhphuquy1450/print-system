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
 const rows = await stmts.listBranches.all();
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

module.exports = router;
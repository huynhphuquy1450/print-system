'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const router = express.Router();
const config = require('../config');
const { stmts } = require('../db');
const { verifyClientCredentials } = require('../services/auth-service');
const { generateAgentToken, hashAgentToken } = require('../services/token-service');
const logger = require('../logger');

// Rate limit chống brute-force client_secret + branch-name squatting.
const registerLimiter = rateLimit({
 windowMs: 60 * 60 * 1000, // 1 hour
 max: config.rateLimit.setupRegisterPerHour,
 standardHeaders: true,
 legacyHeaders: false,
 message: { error: 'Too many registration attempts, try again later' },
});

// HTTPS detection (best-effort: check X-Forwarded-Proto + direct)
function isHttps(req) {
 if (req.headers['x-forwarded-proto'] === 'https') return true;
 if (req.secure) return true;
 return false;
}

/**
 * POST /api/setup/register-branch (Public — dùng client_id + client_secret)
 * Body: { client_id, client_secret, branch_name, location? }
 * Returns: 201 { branch_id, agent_token, topic_prefix }
 *
 * Flow:
 * 1. Rate limit the IP (5/hour by default).
 * 2. Verify client credentials (bcrypt).
 * 3. Validate branch_name (1-100 chars).
 * 4. Generate branch_id (br_<8hex>), agent_token (64 hex).
 * 5. INSERT into branches with client_id atomically (UNIQUE client_id+name → 23505 on dup).
 * 6. Log structured audit entry.
 * 7. Return plaintext agent_token (1-time visibility).
 */
router.post('/register-branch', registerLimiter, async (req, res, next) => {
 try {
 // HTTPS check (warning only in production)
 if (config.env === 'production' && !isHttps(req)) {
 logger.warn('register-branch called over HTTP in production', { ip: req.ip });
 }

 const { client_id, client_secret, branch_name, location } = req.body || {};
 if (!client_id || !client_secret || !branch_name) {
 return res.status(400).json({ error: 'client_id, client_secret, branch_name required' });
 }
 if (typeof branch_name !== 'string' || branch_name.length < 1 || branch_name.length > 100) {
 return res.status(400).json({ error: 'branch_name must be 1-100 chars' });
 }

 // 1. Verify client
 const client = await verifyClientCredentials(client_id, client_secret);
 if (!client) {
 logger.warn('register-branch: bad client credentials', { client_id, ip: req.ip });
 return res.status(401).json({ error: 'Invalid client credentials' });
 }

 // 2. Generate IDs
 const branchId = `br_${crypto.randomBytes(4).toString('hex')}`;
 const agentToken = generateAgentToken();
 const tokenHash = hashAgentToken(agentToken);

 // 3. Insert branch (UNIQUE(client_id, name) → 23505 on dup)
 try {
 await stmts.insertBranch.run({
 id: branchId,
 name: branch_name,
 location: location || null,
 client_id: client_id,
 agent_token_hash: tokenHash,
 created_at: Date.now(),
 });
 } catch (e) {
 if (e.code === '23505') {
 // Disambiguate: was it UNIQUE(client_id, name) or another UNIQUE?
 const existing = await stmts.getBranchByClientAndName.get({ client_id, name: branch_name });
 if (existing) {
 return res.status(409).json({
 error: `Branch '${branch_name}' already exists for this client`,
 });
 }
 return res.status(409).json({ error: 'Branch id collision (retry)' });
 }
 if (e.code === '23503') {
 // FK violation → client_id doesn't exist (shouldn't happen post-verifyClientCredentials)
 return res.status(400).json({ error: 'Invalid client_id (FK violation)' });
 }
 throw e;
 }

 // 4. Audit log
 logger.info('Branch self-registered', {
 branch_id: branchId,
 client_id,
 client_name: client.name,
 branch_name,
 ip: req.ip,
 });

 // 5. Return plaintext token (1-time visibility)
 res.status(201).json({
 branch_id: branchId,
 agent_token: agentToken,
 topic_prefix: config.mqtt.topicPrefix,
 });
 } catch (e) { next(e); }
});

module.exports = router;

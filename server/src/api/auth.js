'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const config = require('../config');
const { verifyClientCredentials, issueClientJwt } = require('../services/auth-service');
const { verifyClient } = require('../middleware/auth');
const logger = require('../logger');

// Rate limit chống brute force login
const loginLimiter = rateLimit({
 windowMs: 60 * 1000,
 max: config.rateLimit.authLoginPerMin,
 standardHeaders: true,
 legacyHeaders: false,
 message: { error: 'Too many login attempts, try again later' },
});

/**
 * POST /api/auth/login
 * Body: { client_id, client_secret }
 * Returns: { token, expires_in }
 */
router.post('/login', loginLimiter, async (req, res, next) => {
 try {
 const { client_id, client_secret } = req.body || {};
 // Audit: ghi mọi lần đăng nhập (thành/bại phân biệt qua status_code)
 res.locals.audit = { action: 'auth.login', resource_type: 'client', resource_id: client_id };
 if (!client_id || !client_secret) {
 return res.status(400).json({ error: 'client_id and client_secret are required' });
 }
 const client = await verifyClientCredentials(client_id, client_secret);
 if (!client) {
 logger.warn('Failed login attempt', { client_id, ip: req.ip });
 return res.status(401).json({ error: 'Invalid credentials' });
 }
 const token = issueClientJwt(client);
 logger.info('Client logged in', { client_id });
 res.json({ token, token_type: 'Bearer', expires_in: config.jwt.expiresIn });
 } catch (e) { next(e); }
});

/**
 * GET /api/auth/me
 * Verify JWT, trả info client
 */
router.get('/me', verifyClient, (req, res) => {
 res.json({ client: req.client });
});

module.exports = router;
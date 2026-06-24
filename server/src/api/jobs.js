'use strict';

const express = require('express');
const router = express.Router();
const jobService = require('../services/job-service');
const { verifyClient, verifyAgent } = require('../middleware/auth');
const { clientRateLimit } = require('../middleware/rate-limit-client');
const { pdfUpload } = require('../middleware/upload');

/**
 * POST /api/print-jobs (Client JWT)
 * multipart/form-data:
 * - pdf: file (application/pdf, ≤ 50 MB)
 * - branch_id: string (required)
 * - printer?: string
 * - metadata?: JSON string
 */
router.post(
 '/',
 verifyClient,
 clientRateLimit(),
 pdfUpload,
 async (req, res, next) => {
 try {
 // Inline field validation (multer parsed text fields into req.body)
 const errors = [];
 if (!req.body.branch_id || typeof req.body.branch_id !== 'string') {
 errors.push("Field 'branch_id' is required");
 }
 if (req.body.printer !== undefined && typeof req.body.printer !== 'string') {
 errors.push("Field 'printer' must be a string");
 }
 if (req.body.metadata !== undefined) {
 if (typeof req.body.metadata !== 'string') {
 errors.push("Field 'metadata' must be a JSON string");
 } else {
 try { JSON.parse(req.body.metadata); }
 catch { errors.push("Field 'metadata' must be valid JSON"); }
 }
 }
 if (!req.file) errors.push("File field 'pdf' is required");
 if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });

 let metadata = {};
 if (req.body.metadata) {
 try { metadata = JSON.parse(req.body.metadata); } catch (e) { metadata = {}; }
 }

 const result = await jobService.createJob({
 branchId: req.body.branch_id,
 printer: req.body.printer || null,
 pdfBuffer: req.file.buffer,
 metadata,
 clientId: req.client.id,
 });
 res.status(201).json(result);
 } catch (e) { next(e); }
 }
);

/**
 * GET /api/print-jobs (Agent token) - list pending jobs khi reconnect
 * Query: ?branch_id=X
 * PHẢI đặt TRƯỚC /:id để tránh nuốt route
 */
router.get('/', verifyAgent, async (req, res, next) => {
 try {
 const branchId = req.query.branch_id;
 if (!branchId) {
 return res.status(400).json({ error: 'branch_id query param is required' });
 }
 if (req.agent.branchId !== branchId) {
 return res.status(403).json({ error: 'Branch mismatch' });
 }
 const jobs = await jobService.listPendingForBranch(branchId);
 res.json({ jobs });
 } catch (e) { next(e); }
});

/**
 * GET /api/print-jobs/:id (Client JWT) - xem status
 */
router.get('/:id', verifyClient, async (req, res, next) => {
 try {
 const job = await jobService.getJob(req.params.id);
 res.json(job);
 } catch (e) { next(e); }
});

/**
 * POST /api/print-jobs/:id/status (Agent token) - callback báo printed/failed
 * Body: { status: 'printed'|'failed', error? }
 */
router.post('/:id/status', verifyAgent, async (req, res, next) => {
 try {
 const { status, error } = req.body || {};
 const result = await jobService.updateJobStatus(
 req.params.id,
 req.agent.branchId,
 status,
 error
 );
 res.json(result);
 } catch (e) { next(e); }
});

/**
 * GET /api/print-jobs/:id/file (Agent token) - download PDF binary
 * Dùng khi agent (re)connect, muốn in lại job đã miss qua MQTT.
 * Chỉ cho job status 'pending' hoặc 'sent'. File printed/failed đã bị cleanup xóa.
 * Response: application/pdf binary, header Content-Disposition: attachment
 */
router.get('/:id/file', verifyAgent, async (req, res, next) => {
 try {
 const { absolutePath, fileSize } = await jobService.getJobFileForAgent(
 req.params.id,
 req.agent.branchId
 );
 res.set({
 'Content-Type': 'application/pdf',
 'Content-Length': fileSize,
 'Content-Disposition': `attachment; filename="${req.params.id}.pdf"`,
 });
 // Stream file (không load hết vào RAM)
 const fs = require('fs');
 fs.createReadStream(absolutePath)
 .on('error', (e) => next(Object.assign(new Error('Stream error: ' + e.message), { status: 500 })))
 .pipe(res);
 } catch (e) { next(e); }
});

module.exports = router;
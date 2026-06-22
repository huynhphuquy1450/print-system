'use strict';

const express = require('express');
const router = express.Router();
const jobService = require('../services/job-service');
const { verifyClient, verifyAgent } = require('../middleware/auth');
const { clientRateLimit } = require('../middleware/rate-limit-client');
const { validate } = require('../middleware/validate');

/**
 * POST /api/print-jobs (Client JWT)
 * Body: { branch_id, printer?, pdf_base64, metadata? }
 */
router.post(
  '/',
  verifyClient,
  clientRateLimit(),
  validate({
    branch_id: { required: true, type: 'string' },
    pdf_base64: { required: true, type: 'string' },
    printer: { type: 'string' },
    metadata: { type: 'object' },
  }),
  async (req, res, next) => {
    try {
      const result = await jobService.createJob({
        branchId: req.body.branch_id,
        printer: req.body.printer,
        pdfBase64: req.body.pdf_base64,
        metadata: req.body.metadata,
        clientId: req.client.id,
      });
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  }
);

/**
 * GET /api/print-jobs (Agent token) - list pending jobs khi reconnect
 * Query: ?branch_id=X
 * PHẢI đặt TRƯỚC /:id để tránh nuốt route
 */
router.get('/', verifyAgent, (req, res, next) => {
  try {
    const branchId = req.query.branch_id;
    if (!branchId) {
      return res.status(400).json({ error: 'branch_id query param is required' });
    }
    if (req.agent.branchId !== branchId) {
      return res.status(403).json({ error: 'Branch mismatch' });
    }
    const jobs = jobService.listPendingForBranch(branchId);
    res.json({ jobs });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/print-jobs/:id (Client JWT) - xem status
 */
router.get('/:id', verifyClient, (req, res, next) => {
  try {
    const job = jobService.getJob(req.params.id);
    res.json(job);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/print-jobs/:id/status (Agent token) - callback báo printed/failed
 * Body: { status: 'printed'|'failed', error? }
 */
router.post('/:id/status', verifyAgent, (req, res, next) => {
  try {
    const { status, error } = req.body || {};
    const result = jobService.updateJobStatus(
      req.params.id,
      req.agent.branchId,
      status,
      error
    );
    res.json(result);
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/print-jobs/:id/file (Agent token) - download PDF binary
 * Dùng khi agent (re)connect, muốn in lại job đã miss qua MQTT.
 * Chỉ cho job status 'pending' hoặc 'sent'. File printed/failed đã bị cleanup xóa.
 * Response: application/pdf binary, header Content-Disposition: attachment
 */
router.get('/:id/file', verifyAgent, (req, res, next) => {
  try {
    const { absolutePath, fileSize } = jobService.getJobFileForAgent(
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
  } catch (e) {
    next(e);
  }
});

module.exports = router;
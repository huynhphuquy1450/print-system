'use strict';

// API v2 — job history/filter + retry thủ công cho HQ (HM3). Endpoint v1 giữ nguyên.
const express = require('express');
const router = express.Router();
const jobService = require('../services/job-service');
const { verifyClient } = require('../middleware/auth');
const { clientRateLimit } = require('../middleware/rate-limit-client');

/**
 * GET /api/v2/print-jobs (Client JWT)
 * Query: ?branch_id=&status=&from=&to=&limit=&offset=  (from/to là ms epoch)
 * Returns: { jobs, total, limit, offset }
 */
router.get('/', verifyClient, async (req, res, next) => {
  try {
    const { branch_id, status, from, to, limit, offset } = req.query;
    const result = await jobService.listJobsFiltered({
      branchId: branch_id,
      status,
      from: from != null ? parseInt(from, 10) : undefined,
      to: to != null ? parseInt(to, 10) : undefined,
      limit,
      offset,
    });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v2/print-jobs/:id/retry (Client JWT) — re-publish job failed/sent tới agent
 */
router.post('/:id/retry', verifyClient, clientRateLimit(), async (req, res, next) => {
  try {
    const result = await jobService.retryJob(req.params.id);
    res.locals.audit = { action: 'job.retry', resource_type: 'job', resource_id: req.params.id };
    res.json(result);
  } catch (e) {
    next(e);
  }
});

module.exports = router;

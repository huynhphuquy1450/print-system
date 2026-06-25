'use strict';

// API v2 — job history/filter + retry thủ công cho HQ (HM3). Endpoint v1 giữ nguyên.
const express = require('express');
const router = express.Router();
const jobService = require('../services/job-service');
const { verifyClient } = require('../middleware/auth');
const { clientRateLimit, bulkRateLimit } = require('../middleware/rate-limit-client');
const { pdfUploadBulk } = require('../middleware/upload');

// Parse optional ms-epoch query param: undefined nếu vắng, null nếu không phải số (→ 400).
function parseEpoch(v) {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * GET /api/v2/print-jobs (Client JWT)
 * Query: ?branch_id=&status=&from=&to=&limit=&offset=  (from/to là ms epoch)
 * Returns: { jobs, total, limit, offset }
 */
router.get('/', verifyClient, async (req, res, next) => {
  try {
    const { branch_id, status, from, to, limit, offset } = req.query;
    const fromMs = parseEpoch(from);
    const toMs = parseEpoch(to);
    if (fromMs === null || toMs === null) {
      return res.status(400).json({ error: 'from/to phải là số (ms epoch)' });
    }
    const result = await jobService.listJobsFiltered({
      clientId: req.client.id,
      branchId: branch_id,
      status,
      from: fromMs,
      to: toMs,
      limit,
      offset,
    });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v2/print-jobs/bulk (Client JWT) — gửi nhiều job cùng lúc (HM7)
 * multipart/form-data:
 * - pdf: nhiều file (≤ MAX_BULK_FILES), pdf[i] ứng với items[i]
 * - items: JSON array string, mỗi phần tử { branch_id, printer?, metadata{user_id} }
 * Trả 201 nếu tất cả OK, 207 nếu có item lỗi (partial). Body: { created, failed }
 * PHẢI đặt TRƯỚC /:id/retry để '/bulk' không bị nuốt thành :id.
 */
router.post('/bulk', verifyClient, clientRateLimit(), pdfUploadBulk, bulkRateLimit(), async (req, res, next) => {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: "Cần ít nhất 1 file field 'pdf'" });
    }
    let items;
    try {
      items = JSON.parse(req.body.items || '[]');
    } catch {
      return res.status(400).json({ error: "Field 'items' phải là JSON array" });
    }
    if (!Array.isArray(items) || items.length !== files.length) {
      return res.status(400).json({
        error: `Số phần tử 'items' (${Array.isArray(items) ? items.length : 'n/a'}) phải khớp số file pdf (${files.length})`,
      });
    }

    const result = await jobService.createJobsBulk({ items, files, clientId: req.client.id });
    res.locals.audit = {
      action: 'job.bulk_create',
      resource_type: 'job',
      resource_id: `${result.created.length}/${items.length}`,
    };
    res.status(result.failed.length ? 207 : 201).json(result);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v2/print-jobs/:id/retry (Client JWT) — re-publish job failed/sent tới agent
 */
router.post('/:id/retry', verifyClient, clientRateLimit(), async (req, res, next) => {
  try {
    const result = await jobService.retryJob(req.params.id, req.client.id);
    res.locals.audit = { action: 'job.retry', resource_type: 'job', resource_id: req.params.id };
    res.json(result);
  } catch (e) {
    next(e);
  }
});

module.exports = router;

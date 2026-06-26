'use strict';

const express = require('express');
const router = express.Router();
const alertService = require('../services/alert-service');
const { verifyClient } = require('../middleware/auth');

// Parse optional ms-epoch query param: undefined nếu vắng, null nếu không phải số (→ 400).
function parseEpoch(v) {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * GET /api/v2/alerts (Client JWT)
 * Query: ?alert_type=&branch_id=&from=&to=&limit=&offset=  (from/to là ms epoch)
 * Returns: { alerts, total, limit, offset }
 */
router.get('/', verifyClient, async (req, res, next) => {
  try {
    const { alert_type, branch_id, from, to, limit, offset } = req.query;
    const fromMs = parseEpoch(from);
    const toMs = parseEpoch(to);
    if (fromMs === null || toMs === null) {
      return res.status(400).json({ error: 'from/to phải là số (ms epoch)' });
    }
    const result = await alertService.list({
      clientId: req.client.id,
      alertType: alert_type,
      branchId: branch_id,
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

module.exports = router;

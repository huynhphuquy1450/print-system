'use strict';

// API v2 — đọc audit log cho HQ (HM3 + HM5). Client JWT.
const express = require('express');
const router = express.Router();
const auditService = require('../services/audit-service');
const { verifyClient } = require('../middleware/auth');

// Parse optional ms-epoch query param: undefined nếu vắng, null nếu không phải số (→ 400).
function parseEpoch(v) {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * GET /api/v2/audit-log (Client JWT)
 * Query: ?actor_id=&action=&from=&to=&limit=&offset=  (from/to là ms epoch)
 * Returns: { entries, total, limit, offset }
 */
router.get('/', verifyClient, async (req, res, next) => {
  try {
    const { actor_id, action, from, to, limit, offset } = req.query;
    const fromMs = parseEpoch(from);
    const toMs = parseEpoch(to);
    if (fromMs === null || toMs === null) {
      return res.status(400).json({ error: 'from/to phải là số (ms epoch)' });
    }
    const result = await auditService.list({
      clientId: req.client.id,
      actorId: actor_id,
      action,
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

'use strict';

// API v2 — đọc audit log cho HQ (HM3 + HM5). Client JWT.
const express = require('express');
const router = express.Router();
const auditService = require('../services/audit-service');
const { verifyClient } = require('../middleware/auth');

/**
 * GET /api/v2/audit-log (Client JWT)
 * Query: ?actor_id=&action=&from=&to=&limit=&offset=  (from/to là ms epoch)
 * Returns: { entries, total, limit, offset }
 */
router.get('/', verifyClient, async (req, res, next) => {
  try {
    const { actor_id, action, from, to, limit, offset } = req.query;
    const result = await auditService.list({
      actorId: actor_id,
      action,
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

module.exports = router;

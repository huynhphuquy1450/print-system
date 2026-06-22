'use strict';

const express = require('express');
const router = express.Router();
const { stmts } = require('../db');
const { verifyClient } = require('../middleware/auth');
const { generateAgentToken, hashAgentToken } = require('../services/token-service');
const { validate } = require('../middleware/validate');

/**
 * POST /api/admin/agents (Client JWT) - bulk create branches
 * Body: { count, prefix?, name_template? }
 * name_template: 'Branch {n}' (default), {n} replaced by 1..count
 * Returns: { branches: [{ id, name, agent_token }] }
 *
 * Use case: tạo 30 chi nhánh 1 lúc.
 */
router.post(
  '/agents',
  verifyClient,
  validate({
    count: { required: true, type: 'number' },
  }),
  (req, res) => {
    const { count, prefix = 'br_', name_template = 'Branch {n}' } = req.body;
    if (count < 1 || count > 100) {
      return res.status(400).json({ error: 'count must be 1..100' });
    }

    const created = [];
    for (let i = 1; i <= count; i++) {
      const padded = String(i).padStart(3, '0');
      const id = `${prefix}${padded}`;
      const name = name_template.replace('{n}', String(i));
      const token = generateAgentToken();

      try {
        stmts.insertBranch.run({
          id,
          name,
          location: null,
          agent_token_hash: hashAgentToken(token),
          created_at: Date.now(),
        });
        created.push({ id, name, agent_token: token });
      } catch (e) {
        if (String(e.message).includes('UNIQUE')) {
          // Skip existing - tiếp tục
          continue;
        }
        throw e;
      }
    }

    res.status(201).json({ created: created.length, branches: created });
  }
);

module.exports = router;
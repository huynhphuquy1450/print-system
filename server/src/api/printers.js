'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { stmts } = require('../db');
const { verifyClient } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

/**
 * GET /api/printers?branch_id=X (Client JWT) - list printers of branch
 */
router.get('/', verifyClient, (req, res) => {
  const branchId = req.query.branch_id;
  if (!branchId) {
    return res.status(400).json({ error: 'branch_id query param is required' });
  }
  const printers = stmts.listPrintersByBranch.all(branchId);
  res.json({ printers });
});

/**
 * POST /api/printers (Client JWT) - tạo printer
 * Body: { id?, branch_id, name, is_default? }
 */
router.post(
  '/',
  verifyClient,
  validate({
    branch_id: { required: true, type: 'string' },
    name: { required: true, type: 'string', minLength: 1, maxLength: 100 },
    is_default: { type: 'number' },
  }),
  (req, res) => {
    const { branch_id, name } = req.body;
    // Check branch exists
    const branch = stmts.getBranchById.get(branch_id);
    if (!branch) return res.status(404).json({ error: `Branch '${branch_id}' not found` });

    const id = req.body.id || `prn_${crypto.randomBytes(4).toString('hex')}`;
    const isDefault = req.body.is_default ? 1 : 0;

    // Nếu set default, unset các default khác
    if (isDefault) {
      const existing = stmts.listPrintersByBranch.all(branch_id);
      for (const p of existing) {
        if (p.is_default) {
          stmts.db.exec(`UPDATE printers SET is_default = 0 WHERE id = '${p.id}'`);
        }
      }
    }

    try {
      stmts.insertPrinter.run({
        id,
        branch_id,
        name,
        is_default: isDefault,
        created_at: Date.now(),
      });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return res.status(409).json({ error: `Printer '${id}' already exists` });
      }
      throw e;
    }

    res.status(201).json({ id, branch_id, name, is_default: isDefault });
  }
);

/**
 * DELETE /api/printers/:id (Client JWT)
 */
router.delete('/:id', verifyClient, (req, res) => {
  const printer = stmts.getPrinterById.get(req.params.id);
  if (!printer) return res.status(404).json({ error: 'Printer not found' });
  stmts.deletePrinter.run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
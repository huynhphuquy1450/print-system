'use strict';

const express = require('express');
const router = express.Router();
const { verifyClient } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const clientService = require('../services/client-service');

/**
 * GET /api/v2/clients — liệt kê tất cả clients (kèm branch_count)
 */
router.get('/', verifyClient, async (req, res, next) => {
  try {
    const clients = await clientService.list();
    res.json({ clients });
  } catch (e) { next(e); }
});

/**
 * POST /api/v2/clients — tạo client mới
 * Body: { name, id? } — id tuỳ chọn (đặt client_id dễ đọc); bỏ trống → tự sinh.
 * Returns: { id, name, secret (plaintext, 1 lần), is_active }
 */
router.post(
  '/',
  verifyClient,
  validate({
    name: { required: true, type: 'string', minLength: 1, maxLength: 100 },
    id: { type: 'string', minLength: 2, maxLength: 64 },
  }),
  async (req, res, next) => {
    try {
      const c = await clientService.create(req.body.name, { id: req.body.id });
      res.locals.audit = { action: 'client.create', resource_type: 'client', resource_id: c.id };
      res.status(201).json(c);
    } catch (e) {
      if (e.code === 'INVALID_CLIENT_ID') return res.status(400).json({ error: e.message });
      if (e.code === 'CLIENT_ID_EXISTS') return res.status(409).json({ error: e.message });
      if (e.code === '23505') return res.status(409).json({ error: `Client '${req.body.name}' đã tồn tại` });
      next(e);
    }
  }
);

/**
 * PATCH /api/v2/clients/:id — bật/tắt client
 * Body: { is_active: 0 | 1 }
 */
router.patch('/:id', verifyClient, async (req, res, next) => {
  try {
    const val = req.body.is_active;
    if (val !== 0 && val !== 1) {
      return res.status(400).json({ error: 'is_active phải là 0 hoặc 1' });
    }
    if (req.params.id === req.client.id && Number(val) === 0) {
      return res.status(400).json({ error: 'Không thể tự vô hiệu hóa client đang đăng nhập' });
    }
    const r = await clientService.setActive(req.params.id, Number(val) === 1);
    if (!r) return res.status(404).json({ error: 'Client không tồn tại' });
    res.locals.audit = { action: 'client.set_active', resource_type: 'client', resource_id: req.params.id };
    res.json(r);
  } catch (e) { next(e); }
});

/**
 * POST /api/v2/clients/:id/rotate-secret — đổi secret
 * Returns: { id, secret (plaintext mới) }
 */
router.post('/:id/rotate-secret', verifyClient, async (req, res, next) => {
  try {
    const r = await clientService.rotateSecret(req.params.id);
    if (!r) return res.status(404).json({ error: 'Client không tồn tại' });
    res.locals.audit = { action: 'client.rotate_secret', resource_type: 'client', resource_id: req.params.id };
    res.json(r);
  } catch (e) { next(e); }
});

module.exports = router;

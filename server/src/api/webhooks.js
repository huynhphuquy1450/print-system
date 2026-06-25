'use strict';

// API v2 — webhook ERP (HM4): ERP đăng ký URL nhận callback khi job đổi trạng thái.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { stmts } = require('../db');
const { verifyClient } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

// Chỉ chấp nhận http/https — chặn scheme lạ (file:, gopher:...). SSRF allowlist host: future.
function isValidUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * POST /api/v2/webhooks (Client JWT)
 * Body: { url, events? }  → trả { id, secret (1 lần), ... } để ERP verify chữ ký HMAC.
 */
router.post(
  '/',
  verifyClient,
  validate({ url: { required: true, type: 'string' }, events: { type: 'string' } }),
  async (req, res, next) => {
    try {
      const { url, events } = req.body;
      if (!isValidUrl(url)) {
        return res.status(400).json({ error: 'url phải là http(s) hợp lệ' });
      }
      const id = `wh_${crypto.randomBytes(6).toString('hex')}`;
      const secret = crypto.randomBytes(24).toString('hex');
      await stmts.insertWebhook.run({
        id,
        client_id: req.client.id,
        url,
        secret,
        events: events || 'job.status',
        created_at: Date.now(),
      });
      res.locals.audit = { action: 'webhook.create', resource_type: 'webhook', resource_id: id };
      res.status(201).json({ id, url, events: events || 'job.status', secret });
    } catch (e) {
      next(e);
    }
  }
);

/** GET /api/v2/webhooks (Client JWT) — list của client, KHÔNG trả secret */
router.get('/', verifyClient, async (req, res, next) => {
  try {
    const rows = await stmts.listWebhooksByClient.all({ client_id: req.client.id });
    const webhooks = rows.map((w) => ({
      id: w.id,
      url: w.url,
      events: w.events,
      is_active: w.is_active,
      created_at: w.created_at,
    }));
    res.json({ webhooks });
  } catch (e) {
    next(e);
  }
});

/** DELETE /api/v2/webhooks/:id (Client JWT) — chỉ xóa webhook của chính client */
router.delete('/:id', verifyClient, async (req, res, next) => {
  try {
    const r = await stmts.deleteWebhook.run({ id: req.params.id, client_id: req.client.id });
    if (!r.rowCount) return res.status(404).json({ error: 'Webhook not found' });
    res.locals.audit = { action: 'webhook.delete', resource_type: 'webhook', resource_id: req.params.id };
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

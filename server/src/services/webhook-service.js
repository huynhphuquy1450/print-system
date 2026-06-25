'use strict';

const crypto = require('crypto');
const { stmts } = require('../db');
const logger = require('../logger');

const DELIVER_TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 200; // backoff = BACKOFF_MS * attempt giữa các lần thử

/** Ký payload HMAC-SHA256 để ERP xác thực nguồn gốc callback. */
function sign(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/** events lưu CSV; kiểm tra một event có nằm trong đăng ký không. */
function eventsMatch(eventsCsv, event) {
  return (eventsCsv || '')
    .split(',')
    .map((s) => s.trim())
    .includes(event);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Gửi 1 callback có retry + timeout. Không bao giờ ném — trả true/false.
 * Tách riêng (export) để test trực tiếp.
 */
async function deliver(hook, payload) {
  const body = JSON.stringify(payload);
  const signature = sign(hook.secret, body);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVER_TIMEOUT_MS);
    try {
      const resp = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Event': payload.event,
          'X-Delivery-Id': payload.delivery_id,
          'X-Signature': `sha256=${signature}`,
        },
        body,
        signal: controller.signal,
      });
      if (resp.ok) {
        logger.info('Webhook delivered', { webhook_id: hook.id, status: resp.status, attempt });
        return true;
      }
      logger.warn('Webhook non-2xx response', { webhook_id: hook.id, status: resp.status, attempt });
    } catch (e) {
      logger.warn('Webhook delivery error', { webhook_id: hook.id, attempt, err: e.message });
    } finally {
      clearTimeout(timer);
    }
    if (attempt < MAX_ATTEMPTS) await sleep(BACKOFF_MS * attempt);
  }
  logger.error('Webhook delivery gave up', { webhook_id: hook.id, url: hook.url });
  return false;
}

/**
 * Phát sự kiện job đổi trạng thái tới mọi webhook active của client.
 * Fire-and-forget: lấy danh sách hook (await DB), rồi gửi không chờ — không chặn caller
 * (vd updateJobStatus của agent). Mọi lỗi nuốt + log.
 */
async function dispatch({ clientId, jobId, status, branchId, metadata }) {
  try {
    if (!clientId) return;
    const event = 'job.status';
    const hooks = await stmts.listActiveWebhooksByClient.all({ client_id: clientId });
    for (const h of hooks.filter((h) => eventsMatch(h.events, event))) {
      const payload = {
        event,
        delivery_id: crypto.randomUUID(),
        job_id: jobId,
        status,
        branch_id: branchId,
        metadata: metadata || {},
        at: Date.now(),
      };
      deliver(h, payload).catch(() => {});
    }
  } catch (e) {
    logger.error('Webhook dispatch error', { err: e.message });
  }
}

module.exports = { sign, eventsMatch, deliver, dispatch };

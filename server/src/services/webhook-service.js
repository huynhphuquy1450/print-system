'use strict';

const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const { stmts } = require('../db');
const config = require('../config');
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

/** Phân loại IP nội bộ / không định tuyến công cộng (chống SSRF). */
function isPrivateIp(ip) {
  let addr = ip;
  if (addr.startsWith('::ffff:')) addr = addr.slice(7); // IPv4-mapped IPv6
  if (net.isIPv4(addr)) {
    const p = addr.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true; // link-local + cloud metadata 169.254.169.254
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    return false;
  }
  if (net.isIPv6(addr)) {
    const low = addr.toLowerCase();
    if (low === '::1' || low === '::') return true;
    if (low.startsWith('fc') || low.startsWith('fd')) return true; // ULA fc00::/7
    if (low.startsWith('fe80')) return true; // link-local
    return false;
  }
  return false;
}

/** Validate URL webhook (sync, dùng lúc đăng ký): chỉ http/https + chặn host nội bộ literal. */
function validateWebhookUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: 'URL không hợp lệ' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: 'url phải là http(s)' };
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return { ok: false, reason: 'host nội bộ không được phép' };
  }
  if (net.isIP(host) && isPrivateIp(host)) {
    return { ok: false, reason: 'host nội bộ không được phép' };
  }
  // Allowlist opt-in: nếu cấu hình WEBHOOK_ALLOWED_HOSTS → chỉ cho exact host hoặc subdomain.
  const allow = config.webhook.allowedHosts;
  if (allow.length && !allow.some((a) => host === a || host.endsWith('.' + a))) {
    return { ok: false, reason: 'host không nằm trong allowlist (WEBHOOK_ALLOWED_HOSTS)' };
  }
  return { ok: true };
}

/**
 * Kiểm tra TRƯỚC khi gửi (async): resolve DNS và chặn nếu trỏ tới IP nội bộ — chống DNS
 * rebinding (tên public trỏ 127.0.0.1 / 169.254.169.254 / mạng riêng). Ném nếu bị chặn.
 */
async function assertPublicUrl(url) {
  const v = validateWebhookUrl(url);
  if (!v.ok) throw new Error(`Webhook URL bị chặn: ${v.reason}`);
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return; // literal đã qua validate ở trên (public)
  const addrs = await dns.lookup(host, { all: true });
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      throw new Error(`Webhook URL bị chặn: host trỏ tới IP nội bộ ${a.address}`);
    }
  }
}

/**
 * Gửi 1 callback có retry + timeout. Không bao giờ ném — trả true/false.
 * Tách riêng (export) để test trực tiếp.
 */
async function deliver(hook, payload) {
  const body = JSON.stringify(payload);
  const signature = sign(hook.secret, body);

  // SSRF guard: chặn trước khi gửi (kể cả khi URL qua DNS rebinding trỏ nội bộ).
  try {
    await assertPublicUrl(hook.url);
  } catch (e) {
    logger.error('Webhook delivery blocked (SSRF guard)', {
      webhook_id: hook.id,
      url: hook.url,
      err: e.message,
    });
    return false;
  }

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
      if (resp.status < 500) {
        // 4xx = lỗi client vĩnh viễn → KHÔNG retry (tránh phí 3 lần thử cho 400/401/404).
        logger.warn('Webhook 4xx (không retry)', { webhook_id: hook.id, status: resp.status, attempt });
        return false;
      }
      logger.warn('Webhook 5xx (sẽ retry)', { webhook_id: hook.id, status: resp.status, attempt });
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

/**
 * Phát cảnh báo (TASK 7) tới mọi webhook active của client có đăng ký event 'alert'.
 * Fire-and-forget giống dispatch. payload mang alert_type + printer_id thay cho job_id.
 */
async function dispatchAlert({ clientId, alertType, branchId, printerId, status, metadata }) {
  try {
    if (!clientId) return;
    const event = 'alert';
    const hooks = await stmts.listActiveWebhooksByClient.all({ client_id: clientId });
    for (const h of hooks.filter((h) => eventsMatch(h.events, event))) {
      const payload = {
        event,
        delivery_id: crypto.randomUUID(),
        alert_type: alertType,
        branch_id: branchId,
        printer_id: printerId || null,
        status,
        metadata: metadata || {},
        at: Date.now(),
      };
      deliver(h, payload).catch(() => {});
    }
  } catch (e) {
    logger.error('Webhook alert dispatch error', { err: e.message });
  }
}

module.exports = { sign, eventsMatch, deliver, dispatch, dispatchAlert, isPrivateIp, validateWebhookUrl, assertPublicUrl };

'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');

/**
 * Per-client rate-limit middleware factory.
 *
 * Phải đặt SAU verifyClient (vì cần req.client.id làm key).
 * Áp dụng cho các write routes của client (POST jobs, branches, printers, admin/agents).
 *
 * Store: MemoryStore mặc định của express-rate-limit (in-process, đủ cho MVP single-server).
 * Nếu scale horizontal (nhiều node) → cần Redis store để counters chia sẻ giữa các node.
 *
 * Default: config.rateLimit.clientWritePerMin requests / minute / client.
 */
function clientRateLimit(opts = {}) {
  const windowMs = opts.windowMs || 60 * 1000;
  const max = opts.max !== undefined ? opts.max : config.rateLimit.clientWritePerMin;
  const message = opts.message || { error: 'Too many requests, slow down' };

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      if (!req.client || !req.client.id) {
        // Defensive: verifyClient phải chạy trước. Nếu tới đây thì bug.
        throw new Error('clientRateLimit requires verifyClient to run first (req.client.id missing)');
      }
      return req.client.id;
    },
    message,
  });
}

// Item-weighted rate-limit cho bulk: giới hạn TỔNG số job/client/cửa-sổ (không phải số request),
// chống 1 request bulk tạo nhiều job vượt hạn mức write (amplification). Đặt SAU multer (cần
// req.files). Bộ đếm in-process (như MemoryStore ở trên) — đủ cho MVP single-server.
const bulkBuckets = new Map(); // clientId -> { count, resetAt }

function bulkRateLimit(opts = {}) {
  const windowMs = opts.windowMs || 60 * 1000;
  const max = opts.max !== undefined ? opts.max : config.rateLimit.clientWritePerMin;
  return (req, res, next) => {
    if (!req.client || !req.client.id) {
      return next(new Error('bulkRateLimit requires verifyClient to run first (req.client.id missing)'));
    }
    const units = (req.files || []).length || 1;
    const now = Date.now();
    let b = bulkBuckets.get(req.client.id);
    if (!b || now >= b.resetAt) {
      b = { count: 0, resetAt: now + windowMs };
      bulkBuckets.set(req.client.id, b);
    }
    if (b.count + units > max) {
      return res.status(429).json({ error: 'Vượt hạn mức tạo job (bulk), thử lại sau' });
    }
    b.count += units;
    next();
  };
}

module.exports = { clientRateLimit, bulkRateLimit };

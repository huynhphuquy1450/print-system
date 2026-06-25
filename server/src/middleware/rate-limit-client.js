'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');
const logger = require('../logger');
const { getRedisClient } = require('../redis');

function clientKey(req) {
  if (!req.client || !req.client.id) {
    // Defensive: verifyClient phải chạy trước. Nếu tới đây thì bug.
    throw new Error('clientRateLimit requires verifyClient to run first (req.client.id missing)');
  }
  return req.client.id;
}

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

  const limiterOpts = {
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: clientKey,
    message,
  };
  // Pluggable: có Redis → counter chia sẻ giữa node; không thì MemoryStore mặc định.
  const redis = getRedisClient();
  if (redis) {
    const { RedisStore } = require('rate-limit-redis');
    limiterOpts.store = new RedisStore({ sendCommand: (...args) => redis.call(...args), prefix: 'rl:client:' });
  }
  return rateLimit(limiterOpts);
}

// Item-weighted rate-limit cho bulk: giới hạn TỔNG số job/client/cửa-sổ (không phải số request),
// chống 1 request bulk tạo nhiều job vượt hạn mức write (amplification). Đặt SAU multer (cần
// req.files). Có Redis → counter chia sẻ giữa node; không thì bộ đếm in-process (single-server).
const bulkBuckets = new Map(); // clientId -> { count, resetAt }
let lastSweep = 0;

// Evict bucket hết hạn để Map không phình theo số client (chỉ memory mode).
function sweepBulkBuckets(now) {
  if (now - lastSweep < 60 * 1000) return;
  lastSweep = now;
  for (const [k, v] of bulkBuckets) {
    if (now >= v.resetAt) bulkBuckets.delete(k);
  }
}

function bulkRateLimit(opts = {}) {
  const windowMs = opts.windowMs || 60 * 1000;
  const max = opts.max !== undefined ? opts.max : config.rateLimit.clientWritePerMin;
  const TOO_MANY = { error: 'Vượt hạn mức tạo job (bulk), thử lại sau' };
  return async (req, res, next) => {
    if (!req.client || !req.client.id) {
      return next(new Error('bulkRateLimit requires verifyClient to run first (req.client.id missing)'));
    }
    const units = (req.files || []).length || 1;

    const redis = getRedisClient();
    if (redis) {
      try {
        const key = `rl:bulk:${req.client.id}`;
        const count = await redis.incrby(key, units);
        if (count === units) await redis.pexpire(key, windowMs); // lần đầu trong cửa sổ → set TTL
        if (count > max) return res.status(429).json(TOO_MANY);
        return next();
      } catch (e) {
        // Redis lỗi → fail-open (không chặn nhầm request hợp lệ), log để theo dõi.
        logger.error('bulkRateLimit Redis lỗi, tạm cho qua', { err: e.message });
        return next();
      }
    }

    const now = Date.now();
    sweepBulkBuckets(now);
    let b = bulkBuckets.get(req.client.id);
    if (!b || now >= b.resetAt) {
      b = { count: 0, resetAt: now + windowMs };
      bulkBuckets.set(req.client.id, b);
    }
    if (b.count + units > max) return res.status(429).json(TOO_MANY);
    b.count += units;
    next();
  };
}

module.exports = { clientRateLimit, bulkRateLimit };

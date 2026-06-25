'use strict';

// Pluggable Redis client cho rate-limit. Trả null nếu REDIS_URL không set → caller dùng
// in-process store (single-server). Lazy: chỉ tạo client + require ioredis khi thực sự cần.
const config = require('./config');
const logger = require('./logger');

let client = null;
let initialized = false;

/** Trả ioredis client dùng chung, hoặc null nếu Redis không được cấu hình. */
function getRedisClient() {
  if (initialized) return client;
  initialized = true;
  if (!config.redis.url) return null;

  const Redis = require('ioredis');
  client = new Redis(config.redis.url, { maxRetriesPerRequest: 2 });
  client.on('error', (e) => logger.error('Redis error', { err: e.message }));
  // Che credential khi log URL.
  logger.info('Redis enabled for rate-limit', { url: config.redis.url.replace(/:[^:@/]*@/, ':***@') });
  return client;
}

// Test-only: reset singleton để mỗi test có instance sạch.
function _reset() {
  client = null;
  initialized = false;
}

module.exports = { getRedisClient, _reset };

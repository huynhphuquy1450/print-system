'use strict';

const crypto = require('crypto');
const config = require('../config');

/**
 * Generate agent token: random 32 bytes hex (64 chars)
 * Đây là credential device (không phải password người dùng) → SHA256 hash là đủ.
 */
function generateAgentToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashAgentToken(token) {
  return crypto.createHash(config.agentTokenHashAlgo).update(token).digest('hex');
}

function verifyAgentToken(plainToken, hash) {
  const candidate = hashAgentToken(plainToken);
  // Constant-time compare
  if (candidate.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
}

module.exports = { generateAgentToken, hashAgentToken, verifyAgentToken };
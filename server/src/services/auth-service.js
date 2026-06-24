'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const config = require('../config');
const { stmts } = require('../db');

/**
 * Verify client credentials: id + secret
 * - secret_hash: bcrypt hash (người dùng, cần slow hash chống brute force)
 * - is_active: 1 = OK
 * Async: awaits the DB lookup (pg returns Promises).
 */
async function verifyClientCredentials(clientId, clientSecret) {
 const client = await stmts.getClientById.get(clientId);
 if (!client) return null;
 if (!client.is_active) return null;

 const ok = bcrypt.compareSync(clientSecret, client.secret_hash);
 if (!ok) return null;

 return { id: client.id, name: client.name };
}

function issueClientJwt(client) {
 const payload = {
 sub: client.id,
 name: client.name,
  type: 'client',
 };
 return jwt.sign(payload, config.jwt.secret, {
 algorithm: config.jwt.algorithm,
 expiresIn: config.jwt.expiresIn,
 });
}

function verifyClientJwt(token) {
 try {
 const decoded = jwt.verify(token, config.jwt.secret, {
 algorithms: [config.jwt.algorithm],
 });
 if (decoded.type !== 'client') return null;
 return decoded;
 } catch (e) {
 return null;
 }
}

/**
 * Tạo client secret random (32 bytes base64)
 */
function generateClientSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

module.exports = {
  verifyClientCredentials,
 issueClientJwt,
 verifyClientJwt,
 generateClientSecret,
};
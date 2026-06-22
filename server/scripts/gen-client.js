#!/usr/bin/env node
'use strict';

/**
 * Tạo client mới (ERP credentials)
 * Usage: node scripts/gen-client.js <client-name>
 *
 * In ra: client_id, client_secret (plaintext, 1 lần duy nhất)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { stmts } = require('../src/db');

const name = process.argv[2];
if (!name) {
  console.error('Usage: node scripts/gen-client.js <client-name>');
  process.exit(1);
}

// Check tồn tại
const existing = stmts.getClientByName.get(name);
if (existing) {
  console.error(`Client '${name}' already exists (id=${existing.id}).`);
  console.error('Use a different name or delete from DB manually.');
  process.exit(1);
}

// Generate
const id = `cli_${crypto.randomBytes(8).toString('hex')}`;
const secret = crypto.randomBytes(32).toString('base64url');
const secretHash = bcrypt.hashSync(secret, 10);

stmts.insertClient.run({
  id,
  name,
  secret_hash: secretHash,
  is_active: 1,
  created_at: Date.now(),
});

console.log('\n=== Client created ===');
console.log(`client_id:     ${id}`);
console.log(`client_secret: ${secret}`);
console.log(`name:          ${name}`);
console.log('\n⚠️  LƯU LẠI secret ở nơi an toàn. Không thể xem lại!');
console.log('Dùng để gọi: POST /api/auth/login với body { client_id, client_secret }');
console.log('===================\n');
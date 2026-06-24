#!/usr/bin/env node
'use strict';

/**
 * Tạo client mới (ERP credentials)
 * Usage:
 * node scripts/gen-client.js <client-name>
 * → in client_id, client_secret ra console (back-compat)
 *
 * OUTPUT_FILE=path/to/install.json node scripts/gen-client.js <client-name>
 * → ghi file install JSON (cho self-service onboarding — agent --register đọc file này)
 *
 * Install file shape:
 * {
 * "server_url": config.server.publicUrl,
 * "client_id": "cli_...",
 * "client_secret": "...", // plaintext, 1-time visibility
 * "client_name": "...",
 * "created_at": "ISO-8601"
 * }
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { stmts } = require('../src/db');
const config = require('../src/config');

/**
 * Core: tạo client mới, return { id, secret, name }.
 * Throw nếu tên đã tồn tại.
 * Pure function — không touch console hay filesystem.
 */
function createClient(name) {
 const existing = stmts.getClientByName.get(name);
 if (existing) {
 const err = new Error(`Client '${name}' already exists (id=${existing.id}).`);
 err.code = 'CLIENT_EXISTS';
 throw err;
 }

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

 return { id, secret, name };
}

/**
 * Write install JSON file (cho self-service onboarding).
 * @returns absolute output path
 */
function writeInstallFile(payload, outputFile) {
 const outPath = path.isAbsolute(outputFile) ? outputFile : path.join(process.cwd(), outputFile);
 fs.mkdirSync(path.dirname(outPath), { recursive: true });
 fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
 return outPath;
}

module.exports = { createClient, writeInstallFile };

// CLI mode
if (require.main === module) {
 const name = process.argv[2];
 if (!name) {
 console.error('Usage: node scripts/gen-client.js <client-name>');
 console.error(' Set OUTPUT_FILE env var to write install JSON instead of console.');
 process.exit(1);
 }

 let result;
 try {
 result = createClient(name);
 } catch (e) {
 console.error(e.message);
 console.error('Use a different name or delete from DB manually.');
 process.exit(1);
 }

 const installPayload = {
 server_url: config.server.publicUrl,
 client_id: result.id,
 client_secret: result.secret,
 client_name: result.name,
 created_at: new Date().toISOString(),
 };

 const outputFile = process.env.OUTPUT_FILE;
 if (outputFile) {
 try {
 const outPath = writeInstallFile(installPayload, outputFile);
 console.log('\n=== Client created (install file written) ===');
 console.log(`client_id: ${result.id}`);
 console.log(`name: ${result.name}`);
 console.log(`install file: ${outPath}`);
 console.log('\n⚠️ Install file chứa client_secret plaintext. Gửi file cho mỗi chi nhánh qua kênh an toàn.');
 console.log(`Mỗi chi nhánh chạy: agent --register ${path.basename(outPath)}`);
 console.log('===================\n');
 } catch (e) {
 console.error(`✗ Cannot write install file: ${e.message}`);
 process.exit(1);
 }
 } else {
 // Console mode (back-compat)
 console.log('\n=== Client created ===');
 console.log(`client_id: ${result.id}`);
 console.log(`client_secret: ${result.secret}`);
 console.log(`name: ${result.name}`);
 console.log('\n⚠️ LƯU LẠI secret ở nơi an toàn. Không thể xem lại!');
 console.log('Dùng để gọi: POST /api/auth/login với body { client_id, client_secret }');
 console.log('Hoặc ghi install file: OUTPUT_FILE=path/to.json node scripts/gen-client.js <name>');
 console.log('===================\n');
 }
}

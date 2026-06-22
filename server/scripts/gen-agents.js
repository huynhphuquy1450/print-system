#!/usr/bin/env node
'use strict';

/**
 * Tạo N branch + agent_token
 * Usage: node scripts/gen-agents.js [count] [prefix]
 *   count: mặc định 3
 *   prefix: mặc định 'br_'
 *
 * In ra CSV: branch_id,name,agent_token (token hiện plaintext, copy vào agent .env)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { stmts } = require('../src/db');
const { generateAgentToken, hashAgentToken } = require('../src/services/token-service');

const count = parseInt(process.argv[2] || '3', 10);
const prefix = process.argv[3] || 'br_';

console.log(`\n=== Creating ${count} branches ===`);
console.log('branch_id,name,agent_token');

let created = 0;
let skipped = 0;
for (let i = 1; i <= count; i++) {
  const padded = String(i).padStart(3, '0');
  const id = `${prefix}${padded}`;
  const name = `Branch ${padded}`;
  const token = generateAgentToken();

  try {
    stmts.insertBranch.run({
      id,
      name,
      location: null,
      agent_token_hash: hashAgentToken(token),
      created_at: Date.now(),
    });
    console.log(`${id},${name},${token}`);
    created++;
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      console.error(`# Skip ${id} (exists)`);
      skipped++;
    } else {
      throw e;
    }
  }
}

console.log(`\n=== Done. Created ${created}, skipped ${skipped} ===`);
console.log('\n⚠️  Copy dòng CSV ở trên vào file agent-{NN}/.env cho từng chi nhánh.');
console.log('Mỗi agent dùng: BRANCH_ID=<id>, AGENT_TOKEN=<token>');
console.log('===================\n');
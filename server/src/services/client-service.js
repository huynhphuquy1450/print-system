'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { stmts } = require('../db');
const { generateClientSecret } = require('./auth-service');

// client_id đi vào JWT `sub` + URL path → giới hạn ký tự an toàn. Bắt đầu bằng chữ/số,
// chỉ a-z 0-9 _ - , dài 2-64. Không truyền id → tự sinh ngẫu nhiên cli_<16 hex>.
const CLIENT_ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;

function validateClientId(id) {
  if (typeof id !== 'string' || !CLIENT_ID_RE.test(id)) {
    const err = new Error('client_id không hợp lệ: chỉ gồm a-z 0-9 _ - , bắt đầu bằng chữ/số, dài 2-64 ký tự');
    err.code = 'INVALID_CLIENT_ID';
    throw err;
  }
  return id;
}

async function create(name, opts = {}) {
  let id;
  if (opts.id !== undefined && opts.id !== null && opts.id !== '') {
    validateClientId(opts.id);
    const existing = await stmts.getClientById.get(opts.id);
    if (existing) {
      const err = new Error(`client_id '${opts.id}' đã tồn tại`);
      err.code = 'CLIENT_ID_EXISTS';
      throw err;
    }
    id = opts.id;
  } else {
    id = `cli_${crypto.randomBytes(8).toString('hex')}`;
  }
  const secret = generateClientSecret();
  const secret_hash = bcrypt.hashSync(secret, 10);
  const created_at = Date.now();
  const is_active = 1;
  // Lỗi 23505 (trùng name) được ném nguyên vẹn cho route map sang 409.
  await stmts.insertClient.run({ id, name, secret_hash, is_active, created_at });
  return { id, name, secret, is_active };
}

async function list() {
  const rows = await stmts.listClientsWithBranchCount.all();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    is_active: r.is_active,
    created_at: r.created_at,
    branch_count: Number(r.branch_count),
  }));
}

async function setActive(id, isActive) {
  const c = await stmts.getClientById.get(id);
  if (!c) return null;
  await stmts.updateClientActive.run({ id, is_active: isActive ? 1 : 0 });
  return { id, is_active: isActive ? 1 : 0 };
}

async function rotateSecret(id) {
  const c = await stmts.getClientById.get(id);
  if (!c) return null;
  const secret = generateClientSecret();
  await stmts.updateClientSecret.run({ id, secret_hash: bcrypt.hashSync(secret, 10) });
  return { id, secret };
}

module.exports = { create, list, setActive, rotateSecret, validateClientId };

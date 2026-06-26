'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { stmts } = require('../db');
const { generateClientSecret } = require('./auth-service');

async function create(name) {
  const id = `cli_${crypto.randomBytes(8).toString('hex')}`;
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

module.exports = { create, list, setActive, rotateSecret };

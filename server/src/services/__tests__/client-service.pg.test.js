'use strict';

// Integration tests for client-service.js — dùng pg-mem giống alert-service.pg.test.js.
// freshModules() cô lập db + client-service trong cùng module registry.

const { newDb } = require('pg-mem');
const bcrypt = require('bcryptjs');

function freshModules() {
  let dbModule;
  let serviceModule;
  jest.isolateModules(() => {
    jest.doMock('pg', () => {
      const mem = newDb({ autoCreateForeignKeyIndices: true });
      const { Pool: MemPool } = mem.adapters.createPg();
      const realPg = jest.requireActual('pg');
      return {
        Pool: MemPool,
        types: realPg.types,
        Client: realPg.Client,
      };
    });
    dbModule = require('../../db');
    serviceModule = require('../client-service');
  });
  return { dbModule, serviceModule };
}

afterAll(async () => {
  // pg-mem instances GC'd when test process exits.
});

describe('clientService (pg-mem integration)', () => {
  test('create() trả secret plaintext và hash khớp bcrypt', async () => {
    const { dbModule, serviceModule } = freshModules();
    const { db, stmts, pool } = dbModule;
    await db.initSchema();

    const result = await serviceModule.create('Acme Corp');
    expect(result.id).toMatch(/^cli_[0-9a-f]{16}$/);
    expect(result.name).toBe('Acme Corp');
    expect(result.is_active).toBe(1);
    expect(typeof result.secret).toBe('string');
    expect(result.secret.length).toBeGreaterThan(0);

    const row = await stmts.getClientById.get({ id: result.id });
    expect(row).not.toBeNull();
    expect(bcrypt.compareSync(result.secret, row.secret_hash)).toBe(true);

    await pool.end();
  });

  test('create() trùng name → rejects với e.code === "23505"', async () => {
    const { dbModule, serviceModule } = freshModules();
    const { db, pool } = dbModule;
    await db.initSchema();

    await serviceModule.create('Duplicate');
    await expect(serviceModule.create('Duplicate')).rejects.toMatchObject({ code: '23505' });

    await pool.end();
  });

  test('list() trả branch_count đúng', async () => {
    const { dbModule, serviceModule } = freshModules();
    const { db, stmts, pool } = dbModule;
    await db.initSchema();

    const c = await serviceModule.create('ClientWithBranches');
    const c2 = await serviceModule.create('ClientNoBranch');
    const now = Date.now();
    await stmts.insertBranch.run({ id: 'br_s1', name: 'B1', location: null, client_id: c.id, agent_token_hash: 'tok_s1', created_at: now });
    await stmts.insertBranch.run({ id: 'br_s2', name: 'B2', location: null, client_id: c.id, agent_token_hash: 'tok_s2', created_at: now });

    const rows = await serviceModule.list();
    const r1 = rows.find((r) => r.id === c.id);
    const r2 = rows.find((r) => r.id === c2.id);
    expect(r1).toBeDefined();
    expect(r1.branch_count).toBe(2);
    expect(r2).toBeDefined();
    expect(r2.branch_count).toBe(0);

    await pool.end();
  });

  test('setActive(id, false) → is_active=0', async () => {
    const { dbModule, serviceModule } = freshModules();
    const { db, stmts, pool } = dbModule;
    await db.initSchema();

    const c = await serviceModule.create('ToDeactivate');
    const result = await serviceModule.setActive(c.id, false);
    expect(result).not.toBeNull();
    expect(result.is_active).toBe(0);

    const row = await stmts.getClientById.get({ id: c.id });
    expect(row.is_active).toBe(0);

    await pool.end();
  });

  test('setActive(id, true) → is_active=1', async () => {
    const { dbModule, serviceModule } = freshModules();
    const { db, pool } = dbModule;
    await db.initSchema();

    const c = await serviceModule.create('ToActivate');
    await serviceModule.setActive(c.id, false);
    const result = await serviceModule.setActive(c.id, true);
    expect(result).not.toBeNull();
    expect(result.is_active).toBe(1);

    await pool.end();
  });

  test('setActive() id không tồn tại → null', async () => {
    const { dbModule, serviceModule } = freshModules();
    const { db, pool } = dbModule;
    await db.initSchema();

    const result = await serviceModule.setActive('cli_nonexistent', false);
    expect(result).toBeNull();

    await pool.end();
  });

  test('rotateSecret() đổi hash: secret cũ không khớp hash mới, secret mới khớp', async () => {
    const { dbModule, serviceModule } = freshModules();
    const { db, stmts, pool } = dbModule;
    await db.initSchema();

    const c = await serviceModule.create('ToRotate');
    const oldSecret = c.secret;

    const rotated = await serviceModule.rotateSecret(c.id);
    expect(rotated).not.toBeNull();
    expect(rotated.id).toBe(c.id);
    expect(typeof rotated.secret).toBe('string');
    expect(rotated.secret).not.toBe(oldSecret);

    const row = await stmts.getClientById.get({ id: c.id });
    expect(bcrypt.compareSync(oldSecret, row.secret_hash)).toBe(false);
    expect(bcrypt.compareSync(rotated.secret, row.secret_hash)).toBe(true);

    await pool.end();
  });

  test('rotateSecret() id không tồn tại → null', async () => {
    const { dbModule, serviceModule } = freshModules();
    const { db, pool } = dbModule;
    await db.initSchema();

    const result = await serviceModule.rotateSecret('cli_ghost');
    expect(result).toBeNull();

    await pool.end();
  });
});

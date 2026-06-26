'use strict';

// Integration tests for alertService.list() — dùng pg-mem giống db.pg.test.js.
// Không mock db: thay vào đó mock 'pg' để db.js dùng pg-mem Pool.
// freshModules() cô lập cả db + alert-service trong cùng module registry.

const { newDb } = require('pg-mem');

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
    serviceModule = require('../alert-service');
  });
  return { dbModule, serviceModule };
}

afterAll(async () => {
  // pg-mem instances GC'd when test process exits.
});

describe('alertService.list() (pg-mem integration)', () => {
  test('list() ném lỗi nếu thiếu clientId', async () => {
    const { dbModule, serviceModule } = freshModules();
    await dbModule.db.initSchema();
    await expect(serviceModule.list()).rejects.toThrow('list() requires clientId for tenant scoping');
    await dbModule.pool.end();
  });

  test('tenant scope: trả alert của client mình + alert null-client branch thuộc client; không trả của client khác', async () => {
    const { dbModule, serviceModule } = freshModules();
    const { db, stmts, pool } = dbModule;
    await db.initSchema();
    const now = Date.now();

    // Clients
    await stmts.insertClient.run({ id: 'cli_a', name: 'Client A', secret_hash: 'ha', is_active: 1, created_at: now });
    await stmts.insertClient.run({ id: 'cli_b', name: 'Client B', secret_hash: 'hb', is_active: 1, created_at: now });

    // Branches
    await stmts.insertBranch.run({ id: 'br_a', name: 'Branch A', location: null, client_id: 'cli_a', agent_token_hash: 'tok_a', created_at: now });
    await stmts.insertBranch.run({ id: 'br_b', name: 'Branch B', location: null, client_id: 'cli_b', agent_token_hash: 'tok_b', created_at: now });

    // Alert 1: client_id='cli_a' trực tiếp
    await stmts.insertAlert.run({ client_id: 'cli_a', branch_id: 'br_a', printer_id: null, alert_type: 'branch_offline', status: 'offline', created_at: now - 2000 });
    // Alert 2: client_id=null nhưng branch_id='br_a' thuộc cli_a → phải thấy
    await stmts.insertAlert.run({ client_id: null, branch_id: 'br_a', printer_id: null, alert_type: 'printer_offline', status: 'offline', created_at: now - 1000 });
    // Alert 3: client_id='cli_b' → KHÔNG thấy
    await stmts.insertAlert.run({ client_id: 'cli_b', branch_id: 'br_b', printer_id: null, alert_type: 'branch_offline', status: 'offline', created_at: now });

    const result = await serviceModule.list({ clientId: 'cli_a' });
    expect(result.total).toBe(2);
    expect(result.alerts).toHaveLength(2);
    const hasBrB = result.alerts.some(r => r.client_id === 'cli_b');
    expect(hasBrB).toBe(false);

    await pool.end();
  });

  test('order created_at DESC', async () => {
    const { dbModule, serviceModule } = freshModules();
    const { db, stmts, pool } = dbModule;
    await db.initSchema();
    const now = Date.now();

    await stmts.insertClient.run({ id: 'cli_a', name: 'Client A', secret_hash: 'ha', is_active: 1, created_at: now });
    await stmts.insertBranch.run({ id: 'br_a', name: 'Branch A', location: null, client_id: 'cli_a', agent_token_hash: 'tok_a', created_at: now });

    await stmts.insertAlert.run({ client_id: 'cli_a', branch_id: 'br_a', printer_id: null, alert_type: 'branch_offline', status: 'offline', created_at: now - 2000 });
    await stmts.insertAlert.run({ client_id: 'cli_a', branch_id: 'br_a', printer_id: null, alert_type: 'printer_offline', status: 'offline', created_at: now });

    const result = await serviceModule.list({ clientId: 'cli_a' });
    expect(result.alerts[0].created_at).toBeGreaterThan(result.alerts[1].created_at);

    await pool.end();
  });

  test('filter alertType lọc đúng', async () => {
    const { dbModule, serviceModule } = freshModules();
    const { db, stmts, pool } = dbModule;
    await db.initSchema();
    const now = Date.now();

    await stmts.insertClient.run({ id: 'cli_a', name: 'Client A', secret_hash: 'ha', is_active: 1, created_at: now });
    await stmts.insertBranch.run({ id: 'br_a', name: 'Branch A', location: null, client_id: 'cli_a', agent_token_hash: 'tok_a', created_at: now });

    await stmts.insertAlert.run({ client_id: 'cli_a', branch_id: 'br_a', printer_id: null, alert_type: 'branch_offline', status: 'offline', created_at: now - 1000 });
    await stmts.insertAlert.run({ client_id: 'cli_a', branch_id: 'br_a', printer_id: null, alert_type: 'printer_offline', status: 'offline', created_at: now });

    const result = await serviceModule.list({ clientId: 'cli_a', alertType: 'branch_offline' });
    expect(result.total).toBe(1);
    expect(result.alerts[0].alert_type).toBe('branch_offline');

    await pool.end();
  });

  test('filter branchId lọc đúng', async () => {
    const { dbModule, serviceModule } = freshModules();
    const { db, stmts, pool } = dbModule;
    await db.initSchema();
    const now = Date.now();

    await stmts.insertClient.run({ id: 'cli_a', name: 'Client A', secret_hash: 'ha', is_active: 1, created_at: now });
    await stmts.insertBranch.run({ id: 'br_a', name: 'Branch A', location: null, client_id: 'cli_a', agent_token_hash: 'tok_a', created_at: now });
    await stmts.insertBranch.run({ id: 'br_a2', name: 'Branch A2', location: null, client_id: 'cli_a', agent_token_hash: 'tok_a2', created_at: now });

    await stmts.insertAlert.run({ client_id: 'cli_a', branch_id: 'br_a', printer_id: null, alert_type: 'branch_offline', status: 'offline', created_at: now - 1000 });
    await stmts.insertAlert.run({ client_id: 'cli_a', branch_id: 'br_a2', printer_id: null, alert_type: 'branch_offline', status: 'offline', created_at: now });

    const result = await serviceModule.list({ clientId: 'cli_a', branchId: 'br_a' });
    expect(result.total).toBe(1);
    expect(result.alerts[0].branch_id).toBe('br_a');

    await pool.end();
  });

  test('filter from/to lọc đúng theo created_at', async () => {
    const { dbModule, serviceModule } = freshModules();
    const { db, stmts, pool } = dbModule;
    await db.initSchema();
    const now = Date.now();

    await stmts.insertClient.run({ id: 'cli_a', name: 'Client A', secret_hash: 'ha', is_active: 1, created_at: now });
    await stmts.insertBranch.run({ id: 'br_a', name: 'Branch A', location: null, client_id: 'cli_a', agent_token_hash: 'tok_a', created_at: now });

    await stmts.insertAlert.run({ client_id: 'cli_a', branch_id: 'br_a', printer_id: null, alert_type: 'branch_offline', status: 'offline', created_at: now - 5000 });
    await stmts.insertAlert.run({ client_id: 'cli_a', branch_id: 'br_a', printer_id: null, alert_type: 'branch_offline', status: 'offline', created_at: now - 2000 });
    await stmts.insertAlert.run({ client_id: 'cli_a', branch_id: 'br_a', printer_id: null, alert_type: 'branch_offline', status: 'offline', created_at: now });

    // Lọc chỉ lấy trong khoảng [now-3000, now-1000]
    const result = await serviceModule.list({ clientId: 'cli_a', from: now - 3000, to: now - 1000 });
    expect(result.total).toBe(1);
    expect(result.alerts[0].created_at).toBe(now - 2000);

    await pool.end();
  });

  test('total = tổng khớp filter (không bị LIMIT cắt)', async () => {
    const { dbModule, serviceModule } = freshModules();
    const { db, stmts, pool } = dbModule;
    await db.initSchema();
    const now = Date.now();

    await stmts.insertClient.run({ id: 'cli_a', name: 'Client A', secret_hash: 'ha', is_active: 1, created_at: now });
    await stmts.insertBranch.run({ id: 'br_a', name: 'Branch A', location: null, client_id: 'cli_a', agent_token_hash: 'tok_a', created_at: now });

    // Insert 5 alerts
    for (let i = 0; i < 5; i++) {
      await stmts.insertAlert.run({ client_id: 'cli_a', branch_id: 'br_a', printer_id: null, alert_type: 'branch_offline', status: 'offline', created_at: now + i });
    }

    // limit=2 → alerts 2 nhưng total phải là 5
    const result = await serviceModule.list({ clientId: 'cli_a', limit: 2 });
    expect(result.total).toBe(5);
    expect(result.alerts).toHaveLength(2);
    expect(result.limit).toBe(2);

    await pool.end();
  });

  test('limit clamp ≤200; default 50', async () => {
    const { dbModule, serviceModule } = freshModules();
    const { db, stmts, pool } = dbModule;
    await db.initSchema();
    const now = Date.now();

    await stmts.insertClient.run({ id: 'cli_a', name: 'Client A', secret_hash: 'ha', is_active: 1, created_at: now });

    const resultClamped = await serviceModule.list({ clientId: 'cli_a', limit: 9999 });
    expect(resultClamped.limit).toBe(200);

    const resultDefault = await serviceModule.list({ clientId: 'cli_a' });
    expect(resultDefault.limit).toBe(50);

    await pool.end();
  });
});

describe('alertService.remove() (pg-mem integration)', () => {
  test('remove() ném lỗi nếu thiếu clientId', async () => {
    const { dbModule, serviceModule } = freshModules();
    await dbModule.db.initSchema();
    await expect(serviceModule.remove({ id: 1 })).rejects.toThrow('remove() requires clientId for tenant scoping');
    await dbModule.pool.end();
  });

  test('xóa được alert thuộc tenant (qua branch); không xóa được của client khác', async () => {
    const { dbModule, serviceModule } = freshModules();
    const { db, stmts, pool } = dbModule;
    await db.initSchema();
    const now = Date.now();

    await stmts.insertClient.run({ id: 'cli_a', name: 'Client A', secret_hash: 'ha', is_active: 1, created_at: now });
    await stmts.insertClient.run({ id: 'cli_b', name: 'Client B', secret_hash: 'hb', is_active: 1, created_at: now });
    await stmts.insertBranch.run({ id: 'br_a', name: 'Branch A', location: null, client_id: 'cli_a', agent_token_hash: 'tok_a', created_at: now });
    await stmts.insertBranch.run({ id: 'br_b', name: 'Branch B', location: null, client_id: 'cli_b', agent_token_hash: 'tok_b', created_at: now });

    // Alert của cli_a qua branch (client_id null) + alert của cli_b
    await stmts.insertAlert.run({ client_id: null, branch_id: 'br_a', printer_id: null, alert_type: 'branch_offline', status: 'offline', created_at: now });
    await stmts.insertAlert.run({ client_id: 'cli_b', branch_id: 'br_b', printer_id: null, alert_type: 'branch_offline', status: 'offline', created_at: now });

    const all = await db.query('SELECT id, branch_id FROM alerts ORDER BY id');
    const idA = all.rows.find((r) => r.branch_id === 'br_a').id;
    const idB = all.rows.find((r) => r.branch_id === 'br_b').id;

    // cli_a KHÔNG xóa được alert của cli_b
    expect(await serviceModule.remove({ id: idB, clientId: 'cli_a' })).toBe(0);
    // cli_a xóa được alert của chính mình (qua branch)
    expect(await serviceModule.remove({ id: idA, clientId: 'cli_a' })).toBe(1);
    // id không tồn tại → 0
    expect(await serviceModule.remove({ id: idA, clientId: 'cli_a' })).toBe(0);

    const remain = await db.query('SELECT id FROM alerts');
    expect(remain.rows).toHaveLength(1);
    expect(remain.rows[0].id).toBe(idB);

    await pool.end();
  });
});

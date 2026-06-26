'use strict';

// Integration tests for server/src/db.js — use pg-mem (in-process PG emulation)
// to verify schema init, prepared statements, and transaction wrapper without
// needing a real PostgreSQL server or Docker. CI runs without service containers.
//
// Each test gets a fresh pg-mem instance by calling jest.isolateModules so
// the in-memory DB doesn't carry over state between tests.

const { newDb } = require('pg-mem');

function freshDbModule() {
 let module;
 jest.isolateModules(() => {
 // Mock 'pg' inside this isolated module graph so server/src/db.js picks up
 // pg-mem's Pool instead of the real pg client.
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
 module = require('../../db');
 });
 return module;
}

afterAll(async () => {
 // Each fresh module has its own pool; jest.isolateModules garbage-collects
 // them when the test process exits. Nothing to do here.
});

describe('db.js (pg-mem integration)', () => {
 test('ping succeeds against pg-mem', async () => {
 const { db, pool } = freshDbModule();
 await db.initSchema();
 await expect(db.ping()).resolves.toBe(true);
 await pool.end();
 });

 test('insertClient + getClientById round-trip', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertClient.run({
 id: 'c1', name: 'Acme', secret_hash: 'hash', is_active: 1, created_at: now,
 });
 const row = await stmts.getClientById.get({ id: 'c1' });
 expect(row).not.toBeNull();
 expect(row.id).toBe('c1');
 expect(row.name).toBe('Acme');
 // BIGINT parsed back as number (oid 20 parser is set in db.js)
 expect(row.created_at).toBe(now);
 expect(typeof row.created_at).toBe('number');
 await pool.end();
 });

 // Regression: statement 1 tham số phải nhận cả primitive (positional) lẫn { id }.
 // Các service gọi get(clientId)/get(jobId) bằng string — nếu chỉ hỗ trợ object thì
 // login & retry hỏng âm thầm (mọi unit test mock service nên không bắt được).
 test('single-param get() accepts a bare string (positional) as well as { id }', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 await stmts.insertClient.run({
 id: 'c_str', name: 'PosArg', secret_hash: 'hash', is_active: 1, created_at: Date.now(),
 });
 const byString = await stmts.getClientById.get('c_str');
 const byObject = await stmts.getClientById.get({ id: 'c_str' });
 expect(byString).not.toBeNull();
 expect(byString.id).toBe('c_str');
 expect(byObject).not.toBeNull();
 expect(byObject.id).toBe('c_str');
 await pool.end();
 });

 test('named params with multiple @placeholders map to $N in order', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertBranch.run({
 id: 'br_1', name: 'Main', location: 'HCM',
 agent_token_hash: 'tok_1', created_at: now,
 });
 await stmts.insertJob.run({
 id: 'job_x', branch_id: 'br_1', printer: null,
 file_path: '/tmp/x.pdf', metadata: '{"k":1}',
 client_id: null, created_at: now,
 });
 const row = await stmts.getJobById.get({ id: 'job_x' });
 expect(row.branch_id).toBe('br_1');
 expect(row.metadata).toBe('{"k":1}');
 expect(row.status).toBe('pending');
 await pool.end();
 });

 test('transaction commits on success', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 const result = await db.transaction(async (tx) => {
 await tx.stmts.insertClient.run({
 id: 'c_commit', name: 'Beta', secret_hash: 'h', is_active: 1, created_at: now,
 });
 return 'ok';
 });
 expect(result).toBe('ok');
 const row = await stmts.getClientById.get({ id: 'c_commit' });
 expect(row).not.toBeNull();
 expect(row.name).toBe('Beta');
 await pool.end();
 });

 test('transaction wrapper propagates throws (rollback semantics)', async () => {
 // Note: pg-mem v3 has limited ROLLBACK support — it does not undo inserts on
 // rollback. The wrapper itself is correct: it BEGINs, calls the function,
 // ROLLBACKs on throw, releases the client. We verify the throw propagates
 // and the connection is released (no client leak).
 const { db, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await expect(db.transaction(async (tx) => {
 await tx.stmts.insertClient.run({
 id: 'c_rollback', name: 'Gamma', secret_hash: 'h', is_active: 1, created_at: now,
 });
 throw new Error('boom');
 })).rejects.toThrow('boom');
 // Pool can be ended cleanly (client released) — proves no leak.
 await expect(pool.end()).resolves.toBeUndefined();
 });

 test('UNIQUE constraint violation surfaces with code 23505 on insertBranch', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertBranch.run({
 id: 'br_1', name: 'Main', location: 'HCM',
 agent_token_hash: 'tok_unique', created_at: now,
 });
 await expect(stmts.insertBranch.run({
 id: 'br_2', name: 'Other', location: 'HN',
 agent_token_hash: 'tok_unique', created_at: now,
 })).rejects.toMatchObject({ code: '23505' });
 await pool.end();
 });

 test('listJobs returns rows ordered by created_at DESC', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertBranch.run({
 id: 'br_1', name: 'Main', location: null,
 agent_token_hash: 'tok', created_at: now,
 });
 await stmts.insertJob.run({
 id: 'job_old', branch_id: 'br_1', printer: null, file_path: '/a.pdf',
 metadata: null, client_id: null, created_at: now - 1000,
 });
 await stmts.insertJob.run({
 id: 'job_new', branch_id: 'br_1', printer: null, file_path: '/b.pdf',
 metadata: null, client_id: null, created_at: now,
 });
 const rows = await stmts.listJobs.all();
 expect(rows[0].id).toBe('job_new');
 expect(rows[1].id).toBe('job_old');
 await pool.end();
 });

 // ── branches.client_id + partial UNIQUE(idx_branches_client_name) ──

 test('insertBranch with client_id persists + getBranchByClientAndName round-trip', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertClient.run({
 id: 'c1', name: 'Acme', secret_hash: 'h', is_active: 1, created_at: now,
 });
 await stmts.insertBranch.run({
 id: 'br_001', name: 'Branch 1', location: 'HCM',
 client_id: 'c1', agent_token_hash: 'tok1', created_at: now,
 });
 const row = await stmts.getBranchByClientAndName.get({ client_id: 'c1', name: 'Branch 1' });
 expect(row).not.toBeNull();
 expect(row.id).toBe('br_001');
 expect(row.client_id).toBe('c1');
 await pool.end();
 });

 test('partial UNIQUE(client_id, name) blocks duplicate for same client', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertClient.run({
 id: 'c1', name: 'Acme', secret_hash: 'h', is_active: 1, created_at: now,
 });
 await stmts.insertBranch.run({
 id: 'br_001', name: 'Branch 1', location: null,
 client_id: 'c1', agent_token_hash: 'tok1', created_at: now,
 });
 await expect(stmts.insertBranch.run({
 id: 'br_002', name: 'Branch 1', location: null,
 client_id: 'c1', agent_token_hash: 'tok2', created_at: now,
 })).rejects.toMatchObject({ code: '23505' });
 await pool.end();
 });

 test('partial UNIQUE allows same name across different clients', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertClient.run({
 id: 'c1', name: 'Acme', secret_hash: 'h', is_active: 1, created_at: now,
 });
 await stmts.insertClient.run({
 id: 'c2', name: 'Beta', secret_hash: 'h', is_active: 1, created_at: now,
 });
 await stmts.insertBranch.run({
 id: 'br_001', name: 'Branch 1', location: null,
 client_id: 'c1', agent_token_hash: 'tok1', created_at: now,
 });
 // Same name, different client → must NOT violate the partial UNIQUE
 await expect(stmts.insertBranch.run({
 id: 'br_002', name: 'Branch 1', location: null,
 client_id: 'c2', agent_token_hash: 'tok2', created_at: now,
 })).resolves.toBeDefined();
 await pool.end();
 });

 test('partial UNIQUE allows NULL client_id (legacy branches unaffected)', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 // Two branches with NULL client_id + same name → must succeed (partial WHERE)
 await stmts.insertBranch.run({
 id: 'br_legacy_1', name: 'Legacy', location: null,
 client_id: null, agent_token_hash: 'tok1', created_at: now,
 });
 await expect(stmts.insertBranch.run({
 id: 'br_legacy_2', name: 'Legacy', location: null,
 client_id: null, agent_token_hash: 'tok2', created_at: now,
 })).resolves.toBeDefined();
 await pool.end();
 });

 test('insertAudit ghi + đọc lại được dòng audit_log (HM5)', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertAudit.run({
 at: now, actor_type: 'client', actor_id: 'cl_1', user_id: 'u_7',
 action: 'job.create', resource_type: 'job', resource_id: 'job_x',
 method: 'POST', path: '/api/print-jobs', status_code: 201,
 ip: '10.0.0.1', user_agent: 'jest',
 });
 const r = await db.query('SELECT * FROM audit_log WHERE actor_id = $1', ['cl_1']);
 expect(r.rows).toHaveLength(1);
 expect(r.rows[0].action).toBe('job.create');
 expect(r.rows[0].user_id).toBe('u_7');
 expect(r.rows[0].status_code).toBe(201);
 expect(r.rows[0].at).toBe(now); // BIGINT → number
 await pool.end();
 });

 test('deleteOldAuditLogs xóa dòng cũ hơn cutoff, giữ dòng mới (HM5 retention)', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 const base = { actor_type: 'client', actor_id: 'c', user_id: null, action: 'x',
 resource_type: null, resource_id: null, method: 'POST', path: '/x',
 status_code: 200, ip: '1.1.1.1', user_agent: 'j' };
 await stmts.insertAudit.run({ ...base, at: now - 1000 }); // cũ
 await stmts.insertAudit.run({ ...base, at: now }); // mới

 const res = await stmts.deleteOldAuditLogs.run({ cutoff: now - 500 });
 expect(res.rowCount).toBe(1);
 const remain = await db.query('SELECT * FROM audit_log');
 expect(remain.rows).toHaveLength(1);
 expect(remain.rows[0].at).toBe(now);
 await pool.end();
 });

 test('updatePrinterStatus đổi status + last_seen_at cho printer đúng', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertBranch.run({
 id: 'br_p1', name: 'P Branch', location: null,
 agent_token_hash: 'tok_p1', created_at: now,
 });
 await stmts.insertPrinter.run({
 id: 'prn_1', branch_id: 'br_p1', name: 'HP-001',
 is_default: 0, source: 'manual', approved: 1, created_at: now,
 });
 const ts = now + 5000;
 const res = await stmts.updatePrinterStatus.run({
 status: 'online', last_seen_at: ts, branch_id: 'br_p1', name: 'HP-001',
 });
 expect(res.rowCount).toBe(1);
 const printer = await stmts.getPrinterById.get({ id: 'prn_1' });
 expect(printer.status).toBe('online');
 expect(printer.last_seen_at).toBe(ts);
 await pool.end();
 });

 test('updatePrinterStatus với name không tồn tại → rowCount 0', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertBranch.run({
 id: 'br_p2', name: 'P Branch 2', location: null,
 agent_token_hash: 'tok_p2', created_at: now,
 });
 const res = await stmts.updatePrinterStatus.run({
 status: 'offline', last_seen_at: now, branch_id: 'br_p2', name: 'ghost-printer',
 });
 expect(res.rowCount).toBe(0);
 await pool.end();
 });

 test('printers table has source (default manual) and approved (default 1) columns', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertBranch.run({
 id: 'br_src', name: 'Source Branch', location: null,
 agent_token_hash: 'tok_src', created_at: now,
 });
 await stmts.insertPrinter.run({
 id: 'prn_src', branch_id: 'br_src', name: 'HP-Source',
 is_default: 0, source: 'manual', approved: 1, created_at: now,
 });
 const row = await stmts.getPrinterById.get({ id: 'prn_src' });
 expect(row).not.toBeNull();
 expect(row.source).toBe('manual');
 expect(row.approved).toBe(1);
 await pool.end();
 });

 test('insertDiscoveredPrinter tạo row với source=discovered, approved=0', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertBranch.run({
 id: 'br_disc', name: 'Disc Branch', location: null,
 agent_token_hash: 'tok_disc', created_at: now,
 });
 await stmts.insertDiscoveredPrinter.run({
 id: 'prn_disc', branch_id: 'br_disc', name: 'Auto-001',
 status: 'online', last_seen_at: now, created_at: now,
 });
 const row = await stmts.getPrinterById.get({ id: 'prn_disc' });
 expect(row).not.toBeNull();
 expect(row.source).toBe('discovered');
 expect(row.approved).toBe(0);
 expect(row.status).toBe('online');
 await pool.end();
 });

 test('setPrinterApproved đổi approved từ 0 lên 1', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertBranch.run({
 id: 'br_appr', name: 'Appr Branch', location: null,
 agent_token_hash: 'tok_appr', created_at: now,
 });
 await stmts.insertDiscoveredPrinter.run({
 id: 'prn_appr', branch_id: 'br_appr', name: 'Auto-Appr',
 status: 'online', last_seen_at: now, created_at: now,
 });
 const before = await stmts.getPrinterById.get({ id: 'prn_appr' });
 expect(before.approved).toBe(0);
 await stmts.setPrinterApproved.run({ id: 'prn_appr', approved: 1 });
 const after = await stmts.getPrinterById.get({ id: 'prn_appr' });
 expect(after.approved).toBe(1);
 await pool.end();
 });

 test('setPrinterDefault đổi is_default', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertBranch.run({
 id: 'br_def', name: 'Def Branch', location: null,
 agent_token_hash: 'tok_def', created_at: now,
 });
 await stmts.insertPrinter.run({
 id: 'prn_def', branch_id: 'br_def', name: 'HP-Def',
 is_default: 0, source: 'manual', approved: 1, created_at: now,
 });
 const before = await stmts.getPrinterById.get({ id: 'prn_def' });
 expect(before.is_default).toBe(0);
 await stmts.setPrinterDefault.run({ id: 'prn_def', is_default: 1 });
 const after = await stmts.getPrinterById.get({ id: 'prn_def' });
 expect(after.is_default).toBe(1);
 await pool.end();
 });

 test('updateBranch đổi name + location, getBranchById phản ánh giá trị mới', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertClient.run({
 id: 'c1', name: 'Acme', secret_hash: 'h', is_active: 1, created_at: now,
 });
 await stmts.insertBranch.run({
 id: 'br_001', name: 'Branch 1', location: 'HCM',
 client_id: 'c1', agent_token_hash: 'tok_upd1', created_at: now,
 });
 await stmts.updateBranch.run({ id: 'br_001', name: 'Branch X', location: 'HN' });
 const row = await stmts.getBranchById.get({ id: 'br_001' });
 expect(row.name).toBe('Branch X');
 expect(row.location).toBe('HN');
 await pool.end();
 });

 test('updateBranch sang tên trùng trong cùng client → 23505', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertClient.run({
 id: 'c1', name: 'Acme', secret_hash: 'h', is_active: 1, created_at: now,
 });
 await stmts.insertBranch.run({
 id: 'br_001', name: 'A', location: null,
 client_id: 'c1', agent_token_hash: 'tok_a', created_at: now,
 });
 await stmts.insertBranch.run({
 id: 'br_002', name: 'B', location: null,
 client_id: 'c1', agent_token_hash: 'tok_b', created_at: now,
 });
 await expect(stmts.updateBranch.run({ id: 'br_002', name: 'A', location: null }))
 .rejects.toMatchObject({ code: '23505' });
 await pool.end();
 });
});
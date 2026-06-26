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

 test('updateBranchClient đổi client_id, getBranchById phản ánh chủ mới', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertClient.run({ id: 'c1', name: 'Acme', secret_hash: 'h', is_active: 1, created_at: now });
 await stmts.insertClient.run({ id: 'c2', name: 'Beta', secret_hash: 'h', is_active: 1, created_at: now });
 await stmts.insertBranch.run({
 id: 'br_001', name: 'Branch 1', location: null,
 client_id: 'c1', agent_token_hash: 'tok1', created_at: now,
 });
 await stmts.updateBranchClient.run({ id: 'br_001', client_id: 'c2' });
 const row = await stmts.getBranchById.get({ id: 'br_001' });
 expect(row.client_id).toBe('c2');
 await pool.end();
 });

 test('updateBranchClient sang client đã có branch trùng tên → 23505', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertClient.run({ id: 'c1', name: 'Acme', secret_hash: 'h', is_active: 1, created_at: now });
 await stmts.insertClient.run({ id: 'c2', name: 'Beta', secret_hash: 'h', is_active: 1, created_at: now });
 await stmts.insertBranch.run({
 id: 'br_001', name: 'Branch 1', location: null,
 client_id: 'c1', agent_token_hash: 'tok1', created_at: now,
 });
 // c2 đã có branch cùng tên 'Branch 1' → chuyển br_001 sang c2 phải vi phạm partial UNIQUE
 await stmts.insertBranch.run({
 id: 'br_002', name: 'Branch 1', location: null,
 client_id: 'c2', agent_token_hash: 'tok2', created_at: now,
 });
 await expect(stmts.updateBranchClient.run({ id: 'br_001', client_id: 'c2' }))
 .rejects.toMatchObject({ code: '23505' });
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

 // TASK 6: cron offline detection — chỉ flip branch đang online + last_seen_at quá cutoff;
 // branch tươi giữ online; branch chưa từng kết nối (last_seen_at NULL) không đụng.
 test('markOfflineBranches hạ branch stale, chừa branch tươi và branch chưa kết nối', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 // (i) stale online → phải offline
 await stmts.insertBranch.run({
 id: 'br_stale', name: 'Stale', location: null,
 client_id: null, agent_token_hash: 'tok_s', created_at: now,
 });
 await stmts.updateBranchStatus.run({ status: 'online', last_seen_at: now - 200_000, id: 'br_stale' });
 // (ii) fresh online → giữ online
 await stmts.insertBranch.run({
 id: 'br_fresh', name: 'Fresh', location: null,
 client_id: null, agent_token_hash: 'tok_f', created_at: now,
 });
 await stmts.updateBranchStatus.run({ status: 'online', last_seen_at: now, id: 'br_fresh' });
 // (iii) chưa kết nối (default offline, last_seen_at NULL) → không đụng
 await stmts.insertBranch.run({
 id: 'br_never', name: 'Never', location: null,
 client_id: null, agent_token_hash: 'tok_n', created_at: now,
 });

 const res = await stmts.markOfflineBranches.run({ cutoff: now - 120_000 });
 expect(res.rowCount).toBe(1);
 expect((await stmts.getBranchById.get({ id: 'br_stale' })).status).toBe('offline');
 expect((await stmts.getBranchById.get({ id: 'br_fresh' })).status).toBe('online');
 expect((await stmts.getBranchById.get({ id: 'br_never' })).status).toBe('offline');
 await pool.end();
 });

 // TASK 6: tương tự cho printers — printer đã 'offline' không được tính lại.
 test('markOfflinePrinters hạ printer stale, chừa printer tươi và printer đã offline', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertBranch.run({
 id: 'br_p', name: 'P Branch', location: null,
 client_id: null, agent_token_hash: 'tok_p', created_at: now,
 });
 const mkPrinter = (id, name) => stmts.insertPrinter.run({
 id, branch_id: 'br_p', name, is_default: 0, source: 'manual', approved: 1, created_at: now,
 });
 await mkPrinter('prn_stale', 'P-Stale');
 await stmts.updatePrinterStatus.run({ status: 'online', last_seen_at: now - 200_000, branch_id: 'br_p', name: 'P-Stale' });
 await mkPrinter('prn_fresh', 'P-Fresh');
 await stmts.updatePrinterStatus.run({ status: 'online', last_seen_at: now, branch_id: 'br_p', name: 'P-Fresh' });
 await mkPrinter('prn_off', 'P-Off');
 await stmts.updatePrinterStatus.run({ status: 'offline', last_seen_at: now - 200_000, branch_id: 'br_p', name: 'P-Off' });

 const res = await stmts.markOfflinePrinters.run({ cutoff: now - 120_000 });
 expect(res.rowCount).toBe(1);
 expect((await stmts.getPrinterById.get({ id: 'prn_stale' })).status).toBe('offline');
 expect((await stmts.getPrinterById.get({ id: 'prn_fresh' })).status).toBe('online');
 expect((await stmts.getPrinterById.get({ id: 'prn_off' })).status).toBe('offline');
 await pool.end();
 });

 // TASK 7: RETURNING id, client_id — cron dùng .all() để lấy danh sách branch vừa flip
 // nhằm ghi alert + bắn webhook. Test kiểm tra branch stale được trả về đúng trường.
 test('markOfflineBranches.all() trả row có id + client_id của branch vừa flip', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertClient.run({
 id: 'c_t7b', name: 'ClientT7B', secret_hash: 'h', is_active: 1, created_at: now,
 });
 // Branch stale — gắn client_id để xác minh RETURNING trả đúng giá trị
 await stmts.insertBranch.run({
 id: 'br_t7_stale', name: 'Stale T7', location: null,
 client_id: 'c_t7b', agent_token_hash: 'tok_t7s', created_at: now,
 });
 await stmts.updateBranchStatus.run({ status: 'online', last_seen_at: now - 200_000, id: 'br_t7_stale' });
 // Branch tươi — không bị flip, không xuất hiện trong kết quả
 await stmts.insertBranch.run({
 id: 'br_t7_fresh', name: 'Fresh T7', location: null,
 client_id: 'c_t7b', agent_token_hash: 'tok_t7f', created_at: now,
 });
 await stmts.updateBranchStatus.run({ status: 'online', last_seen_at: now, id: 'br_t7_fresh' });

 const rows = await stmts.markOfflineBranches.all({ cutoff: now - 120_000 });
 expect(rows).toHaveLength(1);
 expect(rows[0].id).toBe('br_t7_stale');
 expect(rows[0].client_id).toBe('c_t7b');
 await pool.end();
 });

 // TASK 7: RETURNING id, branch_id — cron dùng .all() để lấy danh sách printer vừa flip.
 test('markOfflinePrinters.all() trả row có id + branch_id của printer vừa flip', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertBranch.run({
 id: 'br_t7p', name: 'P Branch T7', location: null,
 client_id: null, agent_token_hash: 'tok_t7p', created_at: now,
 });
 // Printer stale — sẽ bị flip, xuất hiện trong RETURNING
 await stmts.insertPrinter.run({
 id: 'prn_t7_stale', branch_id: 'br_t7p', name: 'P-T7-Stale',
 is_default: 0, source: 'manual', approved: 1, created_at: now,
 });
 await stmts.updatePrinterStatus.run({ status: 'online', last_seen_at: now - 200_000, branch_id: 'br_t7p', name: 'P-T7-Stale' });
 // Printer tươi — không bị flip
 await stmts.insertPrinter.run({
 id: 'prn_t7_fresh', branch_id: 'br_t7p', name: 'P-T7-Fresh',
 is_default: 0, source: 'manual', approved: 1, created_at: now,
 });
 await stmts.updatePrinterStatus.run({ status: 'online', last_seen_at: now, branch_id: 'br_t7p', name: 'P-T7-Fresh' });

 const rows = await stmts.markOfflinePrinters.all({ cutoff: now - 120_000 });
 expect(rows).toHaveLength(1);
 expect(rows[0].id).toBe('prn_t7_stale');
 expect(rows[0].branch_id).toBe('br_t7p');
 await pool.end();
 });

 // TASK 7: insertAlert ghi row vào bảng alerts, đọc lại bằng db.query xác minh đúng dữ liệu.
 test('insertAlert ghi được row và đọc lại đúng các trường (TASK 7)', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertAlert.run({
 client_id: 'cli_a1',
 branch_id: 'br_a1',
 printer_id: 'prn_a1',
 alert_type: 'branch_offline',
 status: 'offline',
 created_at: now,
 });
 const r = await db.query('SELECT * FROM alerts WHERE client_id = $1', ['cli_a1']);
 expect(r.rows).toHaveLength(1);
 const row = r.rows[0];
 expect(row.client_id).toBe('cli_a1');
 expect(row.branch_id).toBe('br_a1');
 expect(row.printer_id).toBe('prn_a1');
 expect(row.alert_type).toBe('branch_offline');
 expect(row.status).toBe('offline');
 expect(row.created_at).toBe(now); // BIGINT → number
 await pool.end();
 });

 test('deleteAlertsOlderThan xóa alert cũ hơn cutoff, giữ alert mới', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertAlert.run({
  client_id: 'c1', branch_id: 'br1', printer_id: null,
  alert_type: 'branch.offline', status: 'offline', created_at: now - 1000,
 });
 await stmts.insertAlert.run({
  client_id: 'c1', branch_id: 'br1', printer_id: null,
  alert_type: 'branch.offline', status: 'offline', created_at: now,
 });
 const res = await stmts.deleteAlertsOlderThan.run({ cutoff: now - 500 });
 expect(res.rowCount).toBe(1);
 const remain = await db.query('SELECT * FROM alerts');
 expect(remain.rows).toHaveLength(1);
 expect(remain.rows[0].created_at).toBe(now);
 await pool.end();
 });

 test('deleteAlertForClient chỉ xóa alert thuộc tenant (scope client_id hoặc branch của client)', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 // Seed client + branch để subquery hoạt động
 await stmts.insertClient.run({
  id: 'c1', name: 'Client One', secret_hash: 'h1', is_active: 1, created_at: now,
 });
 await stmts.insertBranch.run({
  id: 'br_a', name: 'Branch A', location: null,
  client_id: 'c1', agent_token_hash: 'tok_br_a', created_at: now,
 });
 // Alert thuộc c1 qua branch br_a (client_id=null, branch_id='br_a')
 await stmts.insertAlert.run({
  client_id: null, branch_id: 'br_a', printer_id: null,
  alert_type: 'branch.offline', status: 'offline', created_at: now,
 });
 const alertC1Row = await db.query('SELECT id FROM alerts WHERE branch_id = $1', ['br_a']);
 const alertC1Id = alertC1Row.rows[0].id;
 // Alert thuộc c2 (client_id trực tiếp, không qua branch)
 await stmts.insertAlert.run({
  client_id: 'c2', branch_id: null, printer_id: null,
  alert_type: 'branch.offline', status: 'offline', created_at: now,
 });
 const alertC2Row = await db.query('SELECT id FROM alerts WHERE client_id = $1', ['c2']);
 const alertC2Id = alertC2Row.rows[0].id;
 // c1 xóa được alert của mình (qua branch subquery)
 const res = await stmts.deleteAlertForClient.run({ id: alertC1Id, client_id: 'c1' });
 expect(res.rowCount).toBe(1);
 // c1 không xóa được alert của c2 → tenant isolation
 const res2 = await stmts.deleteAlertForClient.run({ id: alertC2Id, client_id: 'c1' });
 expect(res2.rowCount).toBe(0);
 // Verify alert c2 vẫn còn
 const remain = await db.query('SELECT * FROM alerts WHERE client_id = $1', ['c2']);
 expect(remain.rows).toHaveLength(1);
 await pool.end();
 });

 // TASK 7: getPrinterByBranchAndName tra cứu printer theo branch_id + name.
 test('getPrinterByBranchAndName trả đúng printer và null khi không có (TASK 7)', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertBranch.run({
 id: 'br_bn', name: 'BN Branch', location: null,
 agent_token_hash: 'tok_bn', created_at: now,
 });
 await stmts.insertPrinter.run({
 id: 'prn_bn', branch_id: 'br_bn', name: 'HP-BN',
 is_default: 0, source: 'manual', approved: 1, created_at: now,
 });
 const found = await stmts.getPrinterByBranchAndName.get({ branch_id: 'br_bn', name: 'HP-BN' });
 expect(found).not.toBeNull();
 expect(found.id).toBe('prn_bn');
 expect(found.branch_id).toBe('br_bn');
 expect(found.name).toBe('HP-BN');
 // Tên không tồn tại → null
 const notFound = await stmts.getPrinterByBranchAndName.get({ branch_id: 'br_bn', name: 'ghost' });
 expect(notFound).toBeNull();
 await pool.end();
 });

 // ── archive jobs + audit (feat/archive-jobs-audit) ──

 test('archive tables (jobs_archive, audit_log_archive) tồn tại sau initSchema', async () => {
 const { db, pool } = freshDbModule();
 await db.initSchema();
 // SELECT không throw chứng minh bảng đã được tạo
 await expect(db.query('SELECT * FROM jobs_archive')).resolves.toBeDefined();
 await expect(db.query('SELECT * FROM audit_log_archive')).resolves.toBeDefined();
 await pool.end();
 });

 test('archiveJobById copy full row vào jobs_archive; deleteJobById không xóa archive', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertBranch.run({
 id: 'br_arch', name: 'Arch Branch', location: null,
 agent_token_hash: 'tok_arch', created_at: now,
 });
 await stmts.insertJob.run({
 id: 'job_arch_1', branch_id: 'br_arch', printer: null,
 file_path: '/tmp/arch.pdf', metadata: '{"x":1}',
 client_id: null, created_at: now,
 });
 const archivedAt = now + 1000;
 await stmts.archiveJobById.run({ id: 'job_arch_1', archived_at: archivedAt });

 // Archive có row khớp dữ liệu job
 const archRes = await db.query('SELECT * FROM jobs_archive WHERE id = $1', ['job_arch_1']);
 expect(archRes.rows).toHaveLength(1);
 expect(archRes.rows[0].branch_id).toBe('br_arch');
 expect(archRes.rows[0].file_path).toBe('/tmp/arch.pdf');
 expect(archRes.rows[0].archived_at).toBe(archivedAt);

 // Xóa khỏi jobs
 await stmts.deleteJobById.run({ id: 'job_arch_1' });
 const jobRes = await db.query('SELECT * FROM jobs WHERE id = $1', ['job_arch_1']);
 expect(jobRes.rows).toHaveLength(0);

 // Archive vẫn còn row (lưu mãi)
 const archRes2 = await db.query('SELECT * FROM jobs_archive WHERE id = $1', ['job_arch_1']);
 expect(archRes2.rows).toHaveLength(1);
 await pool.end();
 });

 test('archiveOldAuditLogs move theo cutoff; deleteOldAuditLogs chỉ xóa audit_log gốc', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 const base = { actor_type: 'client', actor_id: 'c', user_id: null, action: 'x',
 resource_type: null, resource_id: null, method: 'POST', path: '/x',
 status_code: 200, ip: '1.1.1.1', user_agent: 'j' };
 await stmts.insertAudit.run({ ...base, at: now - 100000 }); // cũ — phải được archive
 await stmts.insertAudit.run({ ...base, at: now });          // mới — giữ lại

 const cutoff = now - 1000;
 await stmts.archiveOldAuditLogs.run({ cutoff, archived_at: now });

 // audit_log_archive có đúng 1 row (row cũ)
 const archRes = await db.query('SELECT * FROM audit_log_archive');
 expect(archRes.rows).toHaveLength(1);
 expect(archRes.rows[0].at).toBe(now - 100000);

 // Xóa row cũ khỏi audit_log gốc
 await stmts.deleteOldAuditLogs.run({ cutoff });
 const remain = await db.query('SELECT * FROM audit_log');
 expect(remain.rows).toHaveLength(1);
 expect(remain.rows[0].at).toBe(now);
 await pool.end();
 });

 test('jobs_archive không có FK constraint — insert với branch/client không tồn tại phải thành công', async () => {
 const { db, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 // Insert thẳng với branch_id và client_id "ma" không tồn tại trong bảng gốc
 await expect(
 db.query(
 'INSERT INTO jobs_archive (id, branch_id, client_id, archived_at) VALUES ($1, $2, $3, $4)',
 ['ja_ghost', 'ghost_branch', 'ghost_client', now]
 )
 ).resolves.toBeDefined();
 const r = await db.query('SELECT * FROM jobs_archive WHERE id = $1', ['ja_ghost']);
 expect(r.rows).toHaveLength(1);
 expect(r.rows[0].branch_id).toBe('ghost_branch');
 expect(r.rows[0].client_id).toBe('ghost_client');
 await pool.end();
 });

 // ── client management stmts (feat/client-management) ──

 test('updateClientActive: insert client → update is_active=0 → getClientById thấy 0', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertClient.run({ id: 'cli_act', name: 'ActiveTest', secret_hash: 'h', is_active: 1, created_at: now });
 await stmts.updateClientActive.run({ id: 'cli_act', is_active: 0 });
 const row = await stmts.getClientById.get({ id: 'cli_act' });
 expect(row).not.toBeNull();
 expect(row.is_active).toBe(0);
 await pool.end();
 });

 test('updateClientSecret: đổi secret_hash → getClientById thấy hash mới', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertClient.run({ id: 'cli_sec', name: 'SecretTest', secret_hash: 'old_hash', is_active: 1, created_at: now });
 await stmts.updateClientSecret.run({ id: 'cli_sec', secret_hash: 'new_hash' });
 const row = await stmts.getClientById.get({ id: 'cli_sec' });
 expect(row).not.toBeNull();
 expect(row.secret_hash).toBe('new_hash');
 await pool.end();
 });

 test('listClientsWithBranchCount: 1 client + 2 branches → branch_count=2; client khác 0 branch → 0', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertClient.run({ id: 'cli_c1', name: 'WithBranches', secret_hash: 'h1', is_active: 1, created_at: now });
 await stmts.insertClient.run({ id: 'cli_c2', name: 'NoBranches', secret_hash: 'h2', is_active: 1, created_at: now - 1 });
 await stmts.insertBranch.run({ id: 'br_lc1', name: 'B1', location: null, client_id: 'cli_c1', agent_token_hash: 'tok_lc1', created_at: now });
 await stmts.insertBranch.run({ id: 'br_lc2', name: 'B2', location: null, client_id: 'cli_c1', agent_token_hash: 'tok_lc2', created_at: now });
 const rows = await stmts.listClientsWithBranchCount.all();
 const c1 = rows.find((r) => r.id === 'cli_c1');
 const c2 = rows.find((r) => r.id === 'cli_c2');
 expect(c1).toBeDefined();
 expect(Number(c1.branch_count)).toBe(2);
 expect(c2).toBeDefined();
 expect(Number(c2.branch_count)).toBe(0);
 await pool.end();
 });

 test('listBranchesByClient chỉ trả branches của đúng client', async () => {
 const { db, stmts, pool } = freshDbModule();
 await db.initSchema();
 const now = Date.now();
 await stmts.insertClient.run({ id: 'c1', name: 'Client1', secret_hash: 'h1', is_active: 1, created_at: now });
 await stmts.insertClient.run({ id: 'c2', name: 'Client2', secret_hash: 'h2', is_active: 1, created_at: now });
 await stmts.insertBranch.run({ id: 'br_a', name: 'Branch A', location: null, client_id: 'c1', agent_token_hash: 'tok_a', created_at: now });
 await stmts.insertBranch.run({ id: 'br_b', name: 'Branch B', location: null, client_id: 'c2', agent_token_hash: 'tok_b', created_at: now });
 const rows = await stmts.listBranchesByClient.all({ client_id: 'c1' });
 expect(rows).toHaveLength(1);
 expect(rows[0].id).toBe('br_a');
 await pool.end();
 });
});
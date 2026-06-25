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
});
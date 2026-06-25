'use strict';

const { Pool, types } = require('pg');
const config = require('./config');
const logger = require('./logger');

// Parse BIGINT (oid 20) as JavaScript number. Safe for ms-epoch until ~year 2255.
// Without this, pg returns BIGINT as a string (default behavior).
types.setTypeParser(20, (v) => (v == null ? null : parseInt(v, 10)));

if (!config.db.url) {
 throw new Error('DATABASE_URL is required. Set it in .env or environment.');
}

const pool = new Pool({
 connectionString: config.db.url,
 max: 10,
 idleTimeoutMillis: 30000,
});

// Schema (PostgreSQL DDL). Timestamps are BIGINT (ms epoch) to match SQLite
// layout — no JS-side date parsing changes. `cleanup_audit.id` uses SERIAL
// because no caller reads the inserted id (no RETURNING needed).
const SCHEMA_SQL = `
 CREATE TABLE IF NOT EXISTS clients (
 id TEXT PRIMARY KEY,
 name TEXT UNIQUE NOT NULL,
 secret_hash TEXT NOT NULL,
 is_active INTEGER DEFAULT 1,
 created_at BIGINT NOT NULL
 );

 CREATE TABLE IF NOT EXISTS branches (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 location TEXT,
 agent_token_hash TEXT UNIQUE NOT NULL,
 status TEXT DEFAULT 'offline',
 last_seen_at BIGINT,
 created_at BIGINT NOT NULL,
 client_id TEXT REFERENCES clients(id) ON DELETE SET NULL
 );

 CREATE TABLE IF NOT EXISTS printers (
 id TEXT PRIMARY KEY,
 branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 is_default INTEGER DEFAULT 0,
 status TEXT DEFAULT 'unknown',
 last_seen_at BIGINT,
 created_at BIGINT NOT NULL
 );

 CREATE TABLE IF NOT EXISTS jobs (
 id TEXT PRIMARY KEY,
 branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
 printer TEXT,
 file_path TEXT NOT NULL,
 status TEXT DEFAULT 'pending',
 metadata TEXT,
 error TEXT,
 created_at BIGINT NOT NULL,
 sent_at BIGINT,
 printed_at BIGINT,
 failed_at BIGINT,
 retry_count INTEGER DEFAULT 0,
 client_id TEXT REFERENCES clients(id) ON DELETE SET NULL
 );

 CREATE INDEX IF NOT EXISTS idx_jobs_branch_status ON jobs(branch_id, status);
 CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);
 CREATE INDEX IF NOT EXISTS idx_jobs_status_sent_at ON jobs(status, sent_at);
 CREATE INDEX IF NOT EXISTS idx_printers_branch ON printers(branch_id);

 CREATE TABLE IF NOT EXISTS cleanup_audit (
 id SERIAL PRIMARY KEY,
 job_id TEXT NOT NULL,
 file_path TEXT,
 branch_id TEXT,
 reason TEXT NOT NULL DEFAULT 'retention',
 deleted_at BIGINT NOT NULL,
 size_bytes BIGINT
 );

 CREATE INDEX IF NOT EXISTS idx_cleanup_audit_deleted_at ON cleanup_audit(deleted_at DESC);
 CREATE INDEX IF NOT EXISTS idx_cleanup_audit_branch ON cleanup_audit(branch_id);

 -- Audit log chi tiết: ai làm gì, lúc nào, từ đâu (IP, user-agent), kết quả (status code).
 -- Ghi cho mọi thao tác ghi (POST/PUT/PATCH/DELETE) + GET nhạy cảm (tải PDF). Cột action
 -- NOT NULL — middleware luôn đặt giá trị (res.locals.audit.action hoặc fallback method+path).
 CREATE TABLE IF NOT EXISTS audit_log (
 id SERIAL PRIMARY KEY,
 at BIGINT NOT NULL,
 actor_type TEXT,
 actor_id TEXT,
 user_id TEXT,
 action TEXT NOT NULL,
 resource_type TEXT,
 resource_id TEXT,
 method TEXT,
 path TEXT,
 status_code INTEGER,
 ip TEXT,
 user_agent TEXT
 );

 CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);
 CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);
 CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);

 -- Partial UNIQUE: one client can't have two branches with the same name.
 -- Partial (WHERE client_id IS NOT NULL) so legacy NULL-client branches are unaffected.
 CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_client_name
 ON branches(client_id, name) WHERE client_id IS NOT NULL;
`;

let initialized = false;

async function initSchema() {
 if (initialized) return;
 await pool.query(SCHEMA_SQL);
 // Migration: ADD COLUMN branches.client_id on existing DBs (CREATE TABLE IF NOT
 // EXISTS does NOT add a missing column to an existing table). Wrapped in try/catch
 // because pg-mem doesn't support `ADD COLUMN IF NOT EXISTS` — and on PG, if the
 // column already exists (fresh install via CREATE TABLE), the ALTER is a no-op.
 try {
 await pool.query(`
 ALTER TABLE branches
 ADD COLUMN IF NOT EXISTS client_id TEXT REFERENCES clients(id) ON DELETE SET NULL
 `);
 } catch (e) {
 if (!/already exists/i.test(e.message)) throw e;
 }
 initialized = true;
 logger.info('Postgres schema initialized');
}

// stmtWithKeys[key].order holds the @name order captured at compile time.
// txStmts uses this to translate { a, b } → [valA, valB] without re-parsing SQL.
const stmtWithKeys = {};

// Compile a SQL string with @name placeholders into a pg statement. The caller
// passes an object { a: 1, b: 2 } which is translated to a positional array
// ordered by first appearance of each @name in the SQL text. This preserves
// the existing service-layer call style that uses named-param objects.
function buildStmt(name, sql) {
 const order = [];
 const pgSql = sql.replace(/@([a-zA-Z_]\w*)/g, (_, k) => {
 if (!order.includes(k)) order.push(k);
 return `$${order.indexOf(k) + 1}`;
 });
 stmtWithKeys[name] = { order, pgSql };

 const orderParams = (params) => order.map((k) =>
 params == null ? null : params[k]
 );

 const run = async (params) => {
 const r = await pool.query(pgSql, orderParams(params));
 return { rowCount: r.rowCount };
 };
 const get = async (params) => {
 const r = await pool.query(pgSql, orderParams(params));
 return r.rows[0] || null;
 };
 const all = async (params) => {
 const r = await pool.query(pgSql, orderParams(params));
 return r.rows;
 };

 return { text: pgSql, get, all, run };
}

const stmts = {
 // Clients
 insertClient: buildStmt('insertClient', `
 INSERT INTO clients (id, name, secret_hash, is_active, created_at)
 VALUES (@id, @name, @secret_hash, @is_active, @created_at)
 `),
 getClientById: buildStmt('getClientById', `SELECT * FROM clients WHERE id = @id`),
 getClientByName: buildStmt('getClientByName', `SELECT * FROM clients WHERE name = @name`),
 listClients: buildStmt('listClients', `SELECT id, name, is_active, created_at FROM clients`),

 // Branches
 insertBranch: buildStmt('insertBranch', `
 INSERT INTO branches (id, name, location, client_id, agent_token_hash, status, created_at)
 VALUES (@id, @name, @location, @client_id, @agent_token_hash, 'offline', @created_at)
 `),
 getBranchById: buildStmt('getBranchById', `SELECT * FROM branches WHERE id = @id`),
 getBranchByClientAndName: buildStmt('getBranchByClientAndName', `
 SELECT * FROM branches WHERE client_id = @client_id AND name = @name
 `),
 getBranchByTokenHash: buildStmt('getBranchByTokenHash', `SELECT * FROM branches WHERE agent_token_hash = @agent_token_hash`),
 listBranches: buildStmt('listBranches', `SELECT * FROM branches ORDER BY created_at DESC`),
 updateBranchToken: buildStmt('updateBranchToken', `
 UPDATE branches SET agent_token_hash = @agent_token_hash WHERE id = @id
 `),
 updateBranchStatus: buildStmt('updateBranchStatus', `
 UPDATE branches SET status = @status, last_seen_at = @last_seen_at WHERE id = @id
 `),

 // Printers
 insertPrinter: buildStmt('insertPrinter', `
 INSERT INTO printers (id, branch_id, name, is_default, status, created_at)
 VALUES (@id, @branch_id, @name, @is_default, 'unknown', @created_at)
 `),
 getPrinterById: buildStmt('getPrinterById', `SELECT * FROM printers WHERE id = @id`),
 listPrintersByBranch: buildStmt('listPrintersByBranch', `
 SELECT * FROM printers WHERE branch_id = @branch_id ORDER BY is_default DESC, name ASC
 `),
 deletePrinter: buildStmt('deletePrinter', `DELETE FROM printers WHERE id = @id`),

 // Jobs
 insertJob: buildStmt('insertJob', `
 INSERT INTO jobs (id, branch_id, printer, file_path, status, metadata, client_id, created_at)
 VALUES (@id, @branch_id, @printer, @file_path, 'pending', @metadata, @client_id, @created_at)
 `),
 getJobById: buildStmt('getJobById', `SELECT * FROM jobs WHERE id = @id`),
 listPendingJobsByBranch: buildStmt('listPendingJobsByBranch', `
 SELECT * FROM jobs WHERE branch_id = @branch_id AND status IN ('pending', 'sent')
 ORDER BY created_at ASC LIMIT 50
 `),
 listJobs: buildStmt('listJobs', `SELECT * FROM jobs ORDER BY created_at DESC LIMIT 200`),
 markJobSent: buildStmt('markJobSent', `
 UPDATE jobs SET status = 'sent', sent_at = @sent_at WHERE id = @id AND status = 'pending'
 `),
 markJobPrinted: buildStmt('markJobPrinted', `
 UPDATE jobs SET status = 'printed', printed_at = @printed_at, error = NULL WHERE id = @id
 `),
 markJobFailed: buildStmt('markJobFailed', `
 UPDATE jobs SET status = 'failed', failed_at = @failed_at, error = @error WHERE id = @id
 `),
 requeueJob: buildStmt('requeueJob', `
 UPDATE jobs SET status = 'sent', sent_at = @sent_at, error = NULL, retry_count = retry_count + 1 WHERE id = @id
 `),
 incrementRetry: buildStmt('incrementRetry', `
 UPDATE jobs SET retry_count = retry_count + 1 WHERE id = @id
 `),
 findStaleJobs: buildStmt('findStaleJobs', `
 SELECT * FROM jobs WHERE status = 'sent' AND sent_at < @cutoff AND retry_count < @max_retries
 ORDER BY sent_at ASC LIMIT 50
 `),
 deleteOldJobs: buildStmt('deleteOldJobs', `
 DELETE FROM jobs WHERE status IN ('printed', 'failed') AND created_at < @cutoff
 `),

 // Cleanup audit
 findOldJobs: buildStmt('findOldJobs', `
 SELECT id, file_path, branch_id FROM jobs
 WHERE status IN ('printed', 'failed') AND created_at < @cutoff
 `),
 deleteJobById: buildStmt('deleteJobById', `DELETE FROM jobs WHERE id = @id`),
 recordCleanup: buildStmt('recordCleanup', `
 INSERT INTO cleanup_audit (job_id, file_path, branch_id, reason, deleted_at, size_bytes)
 VALUES (@job_id, @file_path, @branch_id, @reason, @deleted_at, @size_bytes)
 `),

 // Audit log
 insertAudit: buildStmt('insertAudit', `
 INSERT INTO audit_log
 (at, actor_type, actor_id, user_id, action, resource_type, resource_id, method, path, status_code, ip, user_agent)
 VALUES
 (@at, @actor_type, @actor_id, @user_id, @action, @resource_type, @resource_id, @method, @path, @status_code, @ip, @user_agent)
 `),
};

// Build a tx-bound statement set. Same shape as `stmts` but each call uses the
// tx's connection client (so all queries run inside the same BEGIN/COMMIT block).
function buildTxStmts(client) {
 const out = {};
 for (const [key] of Object.entries(stmts)) {
 const { order, pgSql } = stmtWithKeys[key];
 const orderParams = (params) => order.map((k) =>
 params == null ? null : params[k]
 );
 out[key] = {
 get: async (params) => {
 const r = await client.query(pgSql, orderParams(params));
 return r.rows[0] || null;
 },
 all: async (params) => {
 const r = await client.query(pgSql, orderParams(params));
 return r.rows;
 },
 run: async (params) => {
 const r = await client.query(pgSql, orderParams(params));
 return { rowCount: r.rowCount };
 },
 };
 }
 return out;
}

// Transaction wrapper. Acquires a connection client, runs BEGIN, invokes `fn`
// with a tx object exposing `query(text, params)` and `stmts` (all bound to
// the same client), then COMMITs or ROLLBACKs.
async function transaction(fn) {
 const client = await pool.connect();
 try {
 await client.query('BEGIN');
 const txStmts = buildTxStmts(client);
 const result = await fn({
 query: (text, params) => client.query(text, params),
 stmts: txStmts,
 });
 await client.query('COMMIT');
 return result;
 } catch (e) {
 await client.query('ROLLBACK');
 throw e;
 } finally {
 client.release();
 }
}

const db = {
 query: (text, params) => pool.query(text, params),
 transaction,
 initSchema,
 ping: async () => {
 await pool.query('SELECT 1');
 return true;
 },
 pool,
};

module.exports = { db, stmts, pool };
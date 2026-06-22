'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const logger = require('./logger');

// Đảm bảo folder data tồn tại
const dbPath = path.resolve(__dirname, '..', config.db.path);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    secret_hash TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    location TEXT,
    agent_token_hash TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'offline',
    last_seen_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS printers (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    name TEXT NOT NULL,
    is_default INTEGER DEFAULT 0,
    status TEXT DEFAULT 'unknown',
    last_seen_at INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    printer TEXT,
    file_path TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    metadata TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    sent_at INTEGER,
    printed_at INTEGER,
    failed_at INTEGER,
    retry_count INTEGER DEFAULT 0,
    client_id TEXT,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_branch_status ON jobs(branch_id, status);
  CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_jobs_status_sent_at ON jobs(status, sent_at);
  CREATE INDEX IF NOT EXISTS idx_printers_branch ON printers(branch_id);

  -- Audit log: mỗi lần cleanup-files xóa PDF/job đều ghi 1 row ở đây.
 -- Không có FK tới jobs vì job row bị xóa — audit phải sống sót.
 CREATE TABLE IF NOT EXISTS cleanup_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 job_id TEXT NOT NULL,
 file_path TEXT,
 branch_id TEXT,
 reason TEXT NOT NULL DEFAULT 'retention',
 deleted_at INTEGER NOT NULL,
 size_bytes INTEGER
 );

 CREATE INDEX IF NOT EXISTS idx_cleanup_audit_deleted_at ON cleanup_audit(deleted_at DESC);
 CREATE INDEX IF NOT EXISTS idx_cleanup_audit_branch ON cleanup_audit(branch_id);
`);

logger.info('Database initialized', { path: dbPath });

// Prepared statements
const stmts = {
  // Clients
  insertClient: db.prepare(`
    INSERT INTO clients (id, name, secret_hash, is_active, created_at)
    VALUES (@id, @name, @secret_hash, @is_active, @created_at)
  `),
  getClientById: db.prepare(`SELECT * FROM clients WHERE id = ?`),
  getClientByName: db.prepare(`SELECT * FROM clients WHERE name = ?`),
  listClients: db.prepare(`SELECT id, name, is_active, created_at FROM clients`),

  // Branches
  insertBranch: db.prepare(`
    INSERT INTO branches (id, name, location, agent_token_hash, status, created_at)
    VALUES (@id, @name, @location, @agent_token_hash, 'offline', @created_at)
  `),
  getBranchById: db.prepare(`SELECT * FROM branches WHERE id = ?`),
  getBranchByTokenHash: db.prepare(`SELECT * FROM branches WHERE agent_token_hash = ?`),
  listBranches: db.prepare(`SELECT * FROM branches ORDER BY created_at DESC`),
  updateBranchToken: db.prepare(`
    UPDATE branches SET agent_token_hash = @agent_token_hash WHERE id = @id
  `),
  updateBranchStatus: db.prepare(`
    UPDATE branches SET status = @status, last_seen_at = @last_seen_at WHERE id = @id
  `),

  // Printers
  insertPrinter: db.prepare(`
    INSERT INTO printers (id, branch_id, name, is_default, status, created_at)
    VALUES (@id, @branch_id, @name, @is_default, 'unknown', @created_at)
  `),
  getPrinterById: db.prepare(`SELECT * FROM printers WHERE id = ?`),
  listPrintersByBranch: db.prepare(`SELECT * FROM printers WHERE branch_id = ? ORDER BY is_default DESC, name ASC`),
  deletePrinter: db.prepare(`DELETE FROM printers WHERE id = ?`),

  // Jobs
  insertJob: db.prepare(`
    INSERT INTO jobs (id, branch_id, printer, file_path, status, metadata, client_id, created_at)
    VALUES (@id, @branch_id, @printer, @file_path, 'pending', @metadata, @client_id, @created_at)
  `),
  getJobById: db.prepare(`SELECT * FROM jobs WHERE id = ?`),
  listPendingJobsByBranch: db.prepare(`
    SELECT * FROM jobs WHERE branch_id = ? AND status IN ('pending', 'sent')
    ORDER BY created_at ASC LIMIT 50
  `),
  listJobs: db.prepare(`SELECT * FROM jobs ORDER BY created_at DESC LIMIT 200`),
  markJobSent: db.prepare(`UPDATE jobs SET status = 'sent', sent_at = @sent_at WHERE id = @id AND status = 'pending'`),
  markJobPrinted: db.prepare(`UPDATE jobs SET status = 'printed', printed_at = @printed_at, error = NULL WHERE id = @id`),
  markJobFailed: db.prepare(`UPDATE jobs SET status = 'failed', failed_at = @failed_at, error = @error WHERE id = @id`),
  incrementRetry: db.prepare(`UPDATE jobs SET retry_count = retry_count + 1 WHERE id = @id`),
  findStaleJobs: db.prepare(`
    SELECT * FROM jobs WHERE status = 'sent' AND sent_at < @cutoff AND retry_count < @max_retries
    ORDER BY sent_at ASC LIMIT 50
  `),
  deleteOldJobs: db.prepare(`DELETE FROM jobs WHERE status IN ('printed', 'failed') AND created_at < @cutoff`),

 // Cleanup audit
 findOldJobs: db.prepare(`
 SELECT id, file_path, branch_id FROM jobs
 WHERE status IN ('printed', 'failed') AND created_at < ?
 `),
 deleteJobById: db.prepare(`DELETE FROM jobs WHERE id = ?`),
 recordCleanup: db.prepare(`
 INSERT INTO cleanup_audit (job_id, file_path, branch_id, reason, deleted_at, size_bytes)
 VALUES (@job_id, @file_path, @branch_id, @reason, @deleted_at, @size_bytes)
 `),
};

module.exports = { db, stmts };
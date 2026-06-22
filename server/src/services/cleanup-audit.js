'use strict';

const logger = require('../logger');

/**
 * Record one cleanup audit entry into the `cleanup_audit` table.
 * Pure function: takes a `db` (better-sqlite3 instance) so the caller controls
 * the transactional context. If the caller wraps this in `db.transaction()`,
 * the audit insert and the corresponding job delete are atomic — a failure
 * here rolls back the delete.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} entry
 * @param {string} entry.job_id required — the job that was deleted
 * @param {string|null} [entry.file_path] absolute path at delete time
 * @param {string|null} [entry.branch_id] branch the job belonged to
 * @param {string} [entry.reason='retention'] 'retention' | 'file-missing' | ...
 * @param {number} [entry.deleted_at]  ms epoch; defaults to Date.now()
 * @param {number|null} [entry.size_bytes] file size in bytes (null if missing)
 */
function record(db, entry) {
 const row = {
 job_id: entry.job_id,
 file_path: entry.file_path == null ? null : entry.file_path,
 branch_id: entry.branch_id == null ? null : entry.branch_id,
 reason: entry.reason || 'retention',
 deleted_at: entry.deleted_at || Date.now(),
 size_bytes: entry.size_bytes == null ? null : entry.size_bytes,
 };

 db.prepare(
  `INSERT INTO cleanup_audit
 (job_id, file_path, branch_id, reason, deleted_at, size_bytes)
 VALUES
 (@job_id, @file_path, @branch_id, @reason, @deleted_at, @size_bytes)`
 ).run(row);

 logger.info('Cleanup audit recorded', {
 job_id: row.job_id,
 branch_id: row.branch_id,
 reason: row.reason,
 size_bytes: row.size_bytes,
 });
}

module.exports = { record };

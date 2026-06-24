'use strict';

const logger = require('../logger');

/**
 * Record one cleanup audit entry into the `cleanup_audit` table.
 * Pure function: takes a `tx` (transactional context) so the caller controls
 * whether this runs inside a transaction. If the caller wraps the body in
 * `db.transaction(async (tx) => { ...; audit.record(tx, {...}); ... })`,
 * the audit insert and the corresponding job delete are atomic — a failure
 * here rolls back the delete.
 *
 * @param {object} tx - Transactional context. Must expose `stmts.recordCleanup.run(row)`.
 * Either the module-level `db` (via a tx built with `db.transaction`) or a
 * direct connection client with the same shape.
 * @param {object} entry
 * @param {string} entry.job_id required — the job that was deleted
 * @param {string|null} [entry.file_path] absolute path at delete time
 * @param {string|null} [entry.branch_id] branch the job belonged to
 * @param {string} [entry.reason='retention'] 'retention' | 'file-missing' | ...
 * @param {number} [entry.deleted_at] ms epoch; defaults to Date.now()
 * @param {number|null} [entry.size_bytes] file size in bytes (null if missing)
 */
async function record(tx, entry) {
 const row = {
 job_id: entry.job_id,
 file_path: entry.file_path == null ? null : entry.file_path,
 branch_id: entry.branch_id == null ? null : entry.branch_id,
 reason: entry.reason || 'retention',
 deleted_at: entry.deleted_at || Date.now(),
 size_bytes: entry.size_bytes == null ? null : entry.size_bytes,
 };

 await tx.stmts.recordCleanup.run(row);

 logger.info('Cleanup audit recorded', {
 job_id: row.job_id,
 branch_id: row.branch_id,
 reason: row.reason,
 size_bytes: row.size_bytes,
 });
}

module.exports = { record };
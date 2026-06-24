'use strict';

// cleanup-audit.record() nhận `tx` tham số (không require trực tiếp từ '../db')
// → test tự dựng fake tx qua jest.fn(). tx exposes stmts.recordCleanup.run().
const cleanupAudit = require('../cleanup-audit');

function makeFakeTx() {
 return {
 stmts: {
 recordCleanup: { run: jest.fn().mockResolvedValue({ rowCount: 1 }) },
 },
 };
}

describe('cleanup-audit record()', () => {
 test('inserts a row with all fields', async () => {
 const tx = makeFakeTx();
 await cleanupAudit.record(tx, {
 job_id: 'job_123',
 file_path: '/storage/job_123.pdf',
 branch_id: 'br_001',
 reason: 'retention',
 deleted_at: 1700000000000,
 size_bytes: 4096,
 });

 expect(tx.stmts.recordCleanup.run).toHaveBeenCalledTimes(1);
 const row = tx.stmts.recordCleanup.run.mock.calls[0][0];
 expect(row).toEqual({
 job_id: 'job_123',
 file_path: '/storage/job_123.pdf',
 branch_id: 'br_001',
 reason: 'retention',
 deleted_at: 1700000000000,
 size_bytes: 4096,
 });
 });

 test('defaults reason to "retention" when omitted', async () => {
 const tx = makeFakeTx();
 await cleanupAudit.record(tx, { job_id: 'job_x' });

 const row = tx.stmts.recordCleanup.run.mock.calls[0][0];
 expect(row.reason).toBe('retention');
 });

 test('defaults deleted_at to Date.now() when omitted', async () => {
 const tx = makeFakeTx();
 const before = Date.now();
 await cleanupAudit.record(tx, { job_id: 'job_x' });
 const after = Date.now();

 const ts = tx.stmts.recordCleanup.run.mock.calls[0][0].deleted_at;
 expect(ts).toBeGreaterThanOrEqual(before);
 expect(ts).toBeLessThanOrEqual(after);
 });

 test('null file_path is preserved (no coercion to empty string)', async () => {
 const tx = makeFakeTx();
 await cleanupAudit.record(tx, { job_id: 'job_x' });

 const row = tx.stmts.recordCleanup.run.mock.calls[0][0];
 expect(row.file_path).toBeNull();
 });

 test('null size_bytes preserved when file was missing + reason=file-missing', async () => {
 const tx = makeFakeTx();
 await cleanupAudit.record(tx, {
 job_id: 'job_orphan',
 file_path: null,
 branch_id: 'br_001',
 reason: 'file-missing',
 });

 const row = tx.stmts.recordCleanup.run.mock.calls[0][0];
 expect(row.size_bytes).toBeNull();
 expect(row.reason).toBe('file-missing');
 expect(row.file_path).toBeNull();
 });
});
'use strict';

// cleanup-audit.record() nhận `db` tham số (không require trực tiếp từ '../db')
// → test tự dựng fake db qua jest.fn(). Đơn giản, không cần mock module.

const cleanupAudit = require('../cleanup-audit');

function makeFakeDb() {
 return {
 prepare: jest.fn().mockReturnValue({ run: jest.fn() }),
 };
}

describe('cleanup-audit record()', () => {
 test('inserts a row with all fields', () => {
 const db = makeFakeDb();
 cleanupAudit.record(db, {
 job_id: 'job_123',
 file_path: '/storage/job_123.pdf',
 branch_id: 'br_001',
 reason: 'retention',
 deleted_at: 1700000000000,
 size_bytes: 4096,
 });

 expect(db.prepare).toHaveBeenCalledTimes(1);
 const [sql] = db.prepare.mock.calls[0];
 expect(sql).toMatch(/INSERT INTO cleanup_audit/);
 expect(sql).toContain('@job_id');
 expect(sql).toContain('@size_bytes');

 const run = db.prepare.mock.results[0].value.run;
 expect(run).toHaveBeenCalledTimes(1);
 expect(run.mock.calls[0][0]).toEqual({
 job_id: 'job_123',
 file_path: '/storage/job_123.pdf',
 branch_id: 'br_001',
 reason: 'retention',
 deleted_at: 1700000000000,
 size_bytes: 4096,
 });
 });

 test('defaults reason to "retention" when omitted', () => {
 const db = makeFakeDb();
 cleanupAudit.record(db, { job_id: 'job_x' });

 const row = db.prepare.mock.results[0].value.run.mock.calls[0][0];
 expect(row.reason).toBe('retention');
 });

 test('defaults deleted_at to Date.now() when omitted', () => {
 const db = makeFakeDb();
 const before = Date.now();
 cleanupAudit.record(db, { job_id: 'job_x' });
 const after = Date.now();

 const ts = db.prepare.mock.results[0].value.run.mock.calls[0][0].deleted_at;
 expect(ts).toBeGreaterThanOrEqual(before);
 expect(ts).toBeLessThanOrEqual(after);
 });

 test('null file_path is preserved (no coercion to empty string)', () => {
 const db = makeFakeDb();
 cleanupAudit.record(db, { job_id: 'job_x' });

 const row = db.prepare.mock.results[0].value.run.mock.calls[0][0];
 expect(row.file_path).toBeNull();
 });

 test('null size_bytes preserved when file was missing + reason=file-missing', () => {
 const db = makeFakeDb();
 cleanupAudit.record(db, {
 job_id: 'job_orphan',
 file_path: null,
 branch_id: 'br_001',
 reason: 'file-missing',
 });

 const row = db.prepare.mock.results[0].value.run.mock.calls[0][0];
 expect(row.size_bytes).toBeNull();
 expect(row.reason).toBe('file-missing');
 expect(row.file_path).toBeNull();
 });
});
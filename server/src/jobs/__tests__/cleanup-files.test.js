'use strict';

// Hoisted mocks. cleanup-files.js dùng:
// - db.transaction(async (tx) => {...}) — wrap per-job audit + delete
// → mock identity: async (fn) => fn({ stmts: { recordCleanup, deleteJobById } })
// - stmts.findOldJobs.all(cutoff) — query jobs cũ
// - services/cleanup-audit.record — ghi audit
// - fs.existsSync, fs.statSync, fs.unlinkSync

jest.mock('../../db', () => ({
 db: {
 // Identity wrapper: thay vì BEGIN/COMMIT thật, chạy fn luôn.
 // Throw trong fn sẽ propagate lên caller (giả lập rollback).
 transaction: (fn) => fn({
 stmts: {
 recordCleanup: { run: jest.fn().mockResolvedValue({ rowCount: 1 }) },
 deleteJobById: { run: jest.fn().mockResolvedValue({ rowCount: 1 }) },
 },
 }),
 },
 stmts: {
 findOldJobs: { all: jest.fn() },
 },
}));

jest.mock('../../services/cleanup-audit', () => ({
 record: jest.fn(),
}));

jest.mock('fs', () => ({
 ...jest.requireActual('fs'),
 existsSync: jest.fn(),
 statSync: jest.fn(),
 unlinkSync: jest.fn(),
}));

jest.mock('../../config', () => ({
 ...jest.requireActual('../../config'),
 storage: { path: '/tmp/jest-storage', retentionDays: 7 },
 cron: { ...jest.requireActual('../../config').cron, cleanupHour: 3 },
}));

const fs = require('fs');
const audit = require('../../services/cleanup-audit');
const { db, stmts } = require('../../db');

// cleanup-files có module-level state `lastRunDate` → phải reset module
// giữa các test để run() không skip do "đã chạy hôm nay".
function loadFreshCleanupFiles() {
 jest.resetModules();
 // Re-apply mocks cho module cache mới.
 jest.doMock('../../db', () => ({
 db: {
 transaction: (fn) => fn({
 stmts: {
 recordCleanup: { run: jest.fn().mockResolvedValue({ rowCount: 1 }) },
 deleteJobById: { run: jest.fn().mockResolvedValue({ rowCount: 1 }) },
 },
 }),
 },
 stmts: {
 findOldJobs: { all: stmts.findOldJobs.all },
 },
 }));
 jest.doMock('../../services/cleanup-audit', () => ({
 record: audit.record,
 }));
 jest.doMock('fs', () => ({
 ...jest.requireActual('fs'),
 existsSync: fs.existsSync,
 statSync: fs.statSync,
 unlinkSync: fs.unlinkSync,
 }));
 jest.doMock('../../config', () => ({
 ...jest.requireActual('../../config'),
 storage: { path: '/tmp/jest-storage', retentionDays: 7 },
 cron: { ...jest.requireActual('../../config').cron, cleanupHour: 3 },
 }));
 // eslint-disable-next-line global-require
 return require('../cleanup-files');
}

beforeEach(() => {
 jest.clearAllMocks();
 // Gate cleanupHour = 3; force getHours() trả 3 bất kể khi nào CI chạy.
 jest.spyOn(Date.prototype, 'getHours').mockReturnValue(3);
 fs.existsSync.mockReturnValue(true);
 fs.statSync.mockReturnValue({ size: 4096 });
 fs.unlinkSync.mockReturnValue(undefined);
 audit.record.mockResolvedValue(undefined);
 stmts.findOldJobs.all.mockResolvedValue([]);
 // Re-wire the freshly-reset db.transaction to use current audit mock
 db.transaction = (fn) => fn({
 stmts: {
 recordCleanup: { run: jest.fn().mockResolvedValue({ rowCount: 1 }) },
 deleteJobById: { run: jest.fn().mockResolvedValue({ rowCount: 1 }) },
 },
 });
});

afterEach(() => {
 jest.restoreAllMocks();
});

describe('cleanup-files run()', () => {
 test('no old jobs → audit NOT called, delete NOT called', async () => {
 stmts.findOldJobs.all.mockResolvedValue([]);
 const { run } = loadFreshCleanupFiles();

 await run();

 expect(stmts.findOldJobs.all).toHaveBeenCalledTimes(1);
 expect(audit.record).not.toHaveBeenCalled();
 expect(fs.unlinkSync).not.toHaveBeenCalled();
 });

 test('happy path: audit + unlink + delete cho mỗi job, reason=retention', async () => {
 stmts.findOldJobs.all.mockResolvedValue([
 { id: 'job_1', file_path: '/s/job_1.pdf', branch_id: 'br_001' },
 { id: 'job_2', file_path: '/s/job_2.pdf', branch_id: 'br_002' },
 ]);
 const { run } = loadFreshCleanupFiles();

 await run();

 // 2 audit calls, mỗi cái đúng params
 expect(audit.record).toHaveBeenCalledTimes(2);
 const call0 = audit.record.mock.calls[0];
 expect(call0[0]).toBeDefined(); // tx
 expect(call0[1].job_id).toBe('job_1');
 expect(call0[1].branch_id).toBe('br_001');
 expect(call0[1].reason).toBe('retention');
 expect(call0[1].size_bytes).toBe(4096);

 const call1 = audit.record.mock.calls[1];
 expect(call1[1].job_id).toBe('job_2');
 expect(call1[1].branch_id).toBe('br_002');
 expect(call1[1].reason).toBe('retention');

 // 2 unlink (file deletion happens before the transaction)
 expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
 expect(fs.unlinkSync).toHaveBeenCalledWith('/s/job_1.pdf');
 expect(fs.unlinkSync).toHaveBeenCalledWith('/s/job_2.pdf');
 });

 test('file missing → reason=file-missing, audit still recorded', async () => {
 stmts.findOldJobs.all.mockResolvedValue([
 { id: 'job_orphan', file_path: '/s/gone.pdf', branch_id: 'br_001' },
 ]);
 fs.existsSync.mockReturnValue(false);
 const { run } = loadFreshCleanupFiles();

 await run();

 // Audit vẫn ghi nhưng size=null, reason=file-missing
 expect(audit.record).toHaveBeenCalledTimes(1);
 const callArgs = audit.record.mock.calls[0][1];
 expect(callArgs.job_id).toBe('job_orphan');
 expect(callArgs.reason).toBe('file-missing');
 expect(callArgs.size_bytes).toBeNull();
 expect(callArgs.file_path).toBe('/s/gone.pdf');

 // unlink KHÔNG chạy
 expect(fs.unlinkSync).not.toHaveBeenCalled();
 });

 test('audit throws → next job still processed (per-job transaction isolation)', async () => {
 stmts.findOldJobs.all.mockResolvedValue([
 { id: 'job_1', file_path: '/s/job_1.pdf', branch_id: 'br_001' },
 { id: 'job_2', file_path: '/s/job_2.pdf', branch_id: 'br_002' },
 ]);

 // Override the doMock'd transaction: first call rejects (mimicking disk full),
 // second succeeds. We need to re-require cleanup-files so it picks up the new
 // db mock (loadFreshCleanupFiles doesn't expose the new db object).
 let txCallCount = 0;
 jest.resetModules();
 jest.doMock('../../db', () => ({
 db: {
 transaction: (fn) => {
 txCallCount++;
 if (txCallCount === 1) {
 return Promise.reject(new Error('disk full'));
 }
 return Promise.resolve(fn({
 stmts: {
 recordCleanup: { run: jest.fn().mockResolvedValue({ rowCount: 1 }) },
 deleteJobById: { run: jest.fn().mockResolvedValue({ rowCount: 1 }) },
 },
 }));
 },
 },
 stmts: {
 findOldJobs: { all: stmts.findOldJobs.all },
 },
 }));
 jest.doMock('../../services/cleanup-audit', () => ({
 record: audit.record,
 }));
 jest.doMock('fs', () => ({
 ...jest.requireActual('fs'),
 existsSync: fs.existsSync,
 statSync: fs.statSync,
 unlinkSync: fs.unlinkSync,
 }));
 jest.doMock('../../config', () => ({
 ...jest.requireActual('../../config'),
 storage: { path: '/tmp/jest-storage', retentionDays: 7 },
 cron: { ...jest.requireActual('../../config').cron, cleanupHour: 3 },
 }));
 // eslint-disable-next-line global-require
 const { run } = require('../cleanup-files');

 await run();

 // First job's transaction rejected → that job's audit NOT recorded.
 // Second job's transaction succeeded → audit recorded for job_2.
 expect(audit.record).toHaveBeenCalledTimes(1);
 expect(audit.record.mock.calls[0][1].job_id).toBe('job_2');
 });
});
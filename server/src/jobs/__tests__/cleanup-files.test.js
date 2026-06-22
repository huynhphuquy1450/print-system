'use strict';

// Hoisted mocks. cleanup-files.js dùng:
// - db.transaction((job, reason, sizeBytes) => {...}) — wrap tại module load
// → mock identity: (fn) => fn để transaction chỉ chạy fn trực tiếp.
// - stmts.findOldJobs.all(cutoffMs) — query jobs cũ
// - stmts.deleteJobById.run(id) — xóa row (sau khi audit)
// - services/cleanup-audit.record — ghi audit
// - fs.existsSync, fs.statSync, fs.unlinkSync

jest.mock('../../db', () => ({
 db: {
 // Identity wrapper: thay vì BEGIN/COMMIT thật, chạy fn luôn.
 // Throw trong fn sẽ propagate lên caller (giả lập rollback).
 transaction: (fn) => fn,
 },
 stmts: {
 findOldJobs: { all: jest.fn() },
 deleteJobById: { run: jest.fn() },
 recordCleanup: { run: jest.fn() },
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
const { stmts } = require('../../db');

// cleanup-files có module-level state `lastRunDate` → phải reset module
// giữa các test để run() không skip do "đã chạy hôm nay".
function loadFreshCleanupFiles() {
 jest.resetModules();
 // Re-apply mocks cho module cache mới.
 jest.doMock('../../db', () => ({
 db: { transaction: (fn) => fn },
 stmts: {
 findOldJobs: { all: stmts.findOldJobs.all },
 deleteJobById: { run: stmts.deleteJobById.run },
 recordCleanup: { run: jest.fn() },
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
 audit.record.mockReturnValue(undefined);
 stmts.deleteJobById.run.mockReturnValue({ changes: 1 });
 stmts.findOldJobs.all.mockReturnValue([]);
});

afterEach(() => {
 jest.restoreAllMocks();
});

describe('cleanup-files run()', () => {
 test('no old jobs → audit NOT called, delete NOT called', () => {
 stmts.findOldJobs.all.mockReturnValue([]);
 const { run } = loadFreshCleanupFiles();

 run();

 expect(stmts.findOldJobs.all).toHaveBeenCalledTimes(1);
 expect(audit.record).not.toHaveBeenCalled();
 expect(stmts.deleteJobById.run).not.toHaveBeenCalled();
 expect(fs.unlinkSync).not.toHaveBeenCalled();
 });

 test('happy path: audit + unlink + delete cho mỗi job, reason=retention', () => {
 stmts.findOldJobs.all.mockReturnValue([
 { id: 'job_1', file_path: '/s/job_1.pdf', branch_id: 'br_001' },
 { id: 'job_2', file_path: '/s/job_2.pdf', branch_id: 'br_002' },
 ]);
 const { run } = loadFreshCleanupFiles();

 run();

 // 2 audit calls, mỗi cái đúng params
 expect(audit.record).toHaveBeenCalledTimes(2);
 const call0 = audit.record.mock.calls[0];
 expect(call0[0]).toBeDefined(); // db
 expect(call0[1].job_id).toBe('job_1');
 expect(call0[1].branch_id).toBe('br_001');
 expect(call0[1].reason).toBe('retention');
 expect(call0[1].size_bytes).toBe(4096);

 const call1 = audit.record.mock.calls[1];
 expect(call1[1].job_id).toBe('job_2');
 expect(call1[1].branch_id).toBe('br_002');
 expect(call1[1].reason).toBe('retention');

 // 2 unlink + 2 delete
 expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
 expect(fs.unlinkSync).toHaveBeenCalledWith('/s/job_1.pdf');
 expect(fs.unlinkSync).toHaveBeenCalledWith('/s/job_2.pdf');
 expect(stmts.deleteJobById.run).toHaveBeenCalledTimes(2);
 expect(stmts.deleteJobById.run).toHaveBeenCalledWith('job_1');
 expect(stmts.deleteJobById.run).toHaveBeenCalledWith('job_2');
 });

 test('file missing → reason=file-missing, audit still recorded, row still deleted', () => {
 stmts.findOldJobs.all.mockReturnValue([
 { id: 'job_orphan', file_path: '/s/gone.pdf', branch_id: 'br_001' },
 ]);
 fs.existsSync.mockReturnValue(false);
 const { run } = loadFreshCleanupFiles();

 run();

 // Audit vẫn ghi nhưng size=null, reason=file-missing
 expect(audit.record).toHaveBeenCalledTimes(1);
 const entry = audit.record.mock.calls[0][1];
 expect(entry.job_id).toBe('job_orphan');
 expect(entry.reason).toBe('file-missing');
 expect(entry.size_bytes).toBeNull();
 expect(entry.file_path).toBe('/s/gone.pdf');

 // unlink KHÔNG chạy, nhưng row vẫn xóa
 expect(fs.unlinkSync).not.toHaveBeenCalled();
 expect(stmts.deleteJobById.run).toHaveBeenCalledTimes(1);
 expect(stmts.deleteJobById.run).toHaveBeenCalledWith('job_orphan');
 });

 test('audit throws → deleteJobById NOT called (transaction invariant)', () => {
 stmts.findOldJobs.all.mockReturnValue([
 { id: 'job_1', file_path: '/s/job_1.pdf', branch_id: 'br_001' },
 ]);
 // Với identity transaction mock, throw từ audit.record propagate ra ngoài run().
 audit.record.mockImplementation(() => {
 throw new Error('disk full');
 });
 const { run } = loadFreshCleanupFiles();

 run();

 // Critical invariant: audit throw → delete KHÔNG chạy.
 expect(audit.record).toHaveBeenCalledTimes(1);
 expect(stmts.deleteJobById.run).not.toHaveBeenCalled();
 });
});
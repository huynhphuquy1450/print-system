'use strict';

// Hoisted mocks — same pattern as auth-service.test.js: jest.mock('../../db')
// chặn pg khởi tạo, ta assert trên stmts.* jest.fn().
jest.mock('../../db', () => ({
 stmts: {
 getBranchById: { get: jest.fn() },
 insertJob: { run: jest.fn() },
 getJobById: { get: jest.fn() },
 markJobSent: { run: jest.fn() },
 markJobPrinted: { run: jest.fn() },
 markJobFailed: { run: jest.fn() },
 updateBranchStatus: { run: jest.fn() },
 listPendingJobsByBranch: { all: jest.fn() },
 listJobs: { all: jest.fn() },
 findStaleJobs: { all: jest.fn() },
 },
}));

jest.mock('../../mqtt-client', () => ({
 publishJob: jest.fn(),
 isConnected: jest.fn(),
}));

// Partial fs: chỉ chặn 4 sync methods job-service dùng; giữ nguyên các method khác.
jest.mock('fs', () => ({
 ...jest.requireActual('fs'),
 mkdirSync: jest.fn(),
 writeFileSync: jest.fn(),
 existsSync: jest.fn(),
 statSync: jest.fn(),
}));

// Partial config: override storage.path để predictable; giữ mqtt/jwt/cron.
jest.mock('../../config', () => ({
 ...jest.requireActual('../../config'),
 storage: { path: '/tmp/jest-storage', retentionDays: 7 },
}));

const fs = require('fs');
const mqttClient = require('../../mqtt-client');
const { stmts } = require('../../db');
const {
 HttpError,
 createJob,
 getJob,
 listPendingForBranch,
 listAllJobs,
 updateJobStatus,
 getJobFileForAgent,
} = require('../job-service');

const BRANCH = 'br_001';
// Raw PDF buffer (đủ lớn và có magic bytes hợp lệ) — multer memoryStorage cho ra Buffer
const VALID_PDF_BUF = Buffer.from('%PDF-1.4\nfake content');
const BRANCH_ROW = { id: BRANCH, name: 'Test Branch' };

describe('job-service', () => {
 beforeEach(() => {
 jest.clearAllMocks();

 // fs defaults
 fs.mkdirSync.mockReturnValue(undefined);
 fs.writeFileSync.mockReturnValue(undefined);
 fs.existsSync.mockReturnValue(true);
 fs.statSync.mockReturnValue({ size: 4096 });

 // mqtt defaults
 mqttClient.publishJob.mockResolvedValue(true);
 mqttClient.isConnected.mockReturnValue(true);

 // db defaults — branch tồn tại, job not found (override per test)
 stmts.getBranchById.get.mockResolvedValue(BRANCH_ROW);
 stmts.insertJob.run.mockResolvedValue({ rowCount: 1 });
 stmts.markJobSent.run.mockResolvedValue({ rowCount: 1 });
 stmts.markJobPrinted.run.mockResolvedValue({ rowCount: 1 });
 stmts.markJobFailed.run.mockResolvedValue({ rowCount: 1 });
 stmts.updateBranchStatus.run.mockResolvedValue({ rowCount: 1 });
 stmts.getJobById.get.mockResolvedValue(null);
 stmts.listPendingJobsByBranch.all.mockResolvedValue([]);
 stmts.listJobs.all.mockResolvedValue([]);
 stmts.findStaleJobs.all.mockResolvedValue([]);
 });

 describe('HttpError', () => {
 test('carries status and message', () => {
 const e = new HttpError(418, 'I am a teapot');
 expect(e).toBeInstanceOf(Error);
 expect(e.status).toBe(418);
 expect(e.message).toBe('I am a teapot');
 });
 });

 describe('createJob', () => {
 test('happy path: returns job_id, writes PDF, inserts DB, publishes MQTT v2, marks sent', async () => {
 const result = await createJob({
 branchId: BRANCH,
 printer: 'hp-laserjet',
 pdfBuffer: VALID_PDF_BUF,
 metadata: { user_id: 'EMP-1' },
 clientId: 'client_001',
 });

 expect(result.job_id).toMatch(/^job_\d+_[0-9a-f]+$/);
 expect(result.status).toBe('queued');

 // fs: mkdir + writeFile
 expect(fs.mkdirSync).toHaveBeenCalledTimes(1);
 expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
 const [writtenPath, writtenBuf] = fs.writeFileSync.mock.calls[0];
 expect(writtenPath).toMatch(/\.pdf$/);
 expect(Buffer.isBuffer(writtenBuf)).toBe(true);
 expect(writtenBuf.equals(VALID_PDF_BUF)).toBe(true);

 // DB insert
 expect(stmts.insertJob.run).toHaveBeenCalledTimes(1);
 const insertArg = stmts.insertJob.run.mock.calls[0][0];
 expect(insertArg.id).toBe(result.job_id);
 expect(insertArg.branch_id).toBe(BRANCH);
 expect(insertArg.printer).toBe('hp-laserjet');
 expect(insertArg.file_path).toBe(writtenPath);
 expect(insertArg.metadata).toBe('{"user_id":"EMP-1"}');
 expect(insertArg.client_id).toBe('client_001');
 expect(typeof insertArg.created_at).toBe('number');

 // MQTT publish — protocol v2: chỉ metadata, KHÔNG có pdf_base64
 expect(mqttClient.publishJob).toHaveBeenCalledTimes(1);
 const [pubBranch, pubPayload] = mqttClient.publishJob.mock.calls[0];
 expect(pubBranch).toBe(BRANCH);
 expect(pubPayload.job_id).toBe(result.job_id);
 expect(pubPayload.version).toBe(2);
 expect(pubPayload.printer).toBe('hp-laserjet');
 expect(pubPayload.metadata).toEqual({ user_id: 'EMP-1' });
 expect(pubPayload).not.toHaveProperty('pdf_base64');

 expect(stmts.markJobSent.run).toHaveBeenCalledTimes(1);
 });

 test('throws 400 if branchId missing', async () => {
 await expect(
 createJob({ branchId: '', pdfBuffer: VALID_PDF_BUF, metadata: {}, clientId: 'c' })
 ).rejects.toMatchObject({ status: 400, message: /branch_id is required/ });
 expect(fs.writeFileSync).not.toHaveBeenCalled();
 expect(stmts.insertJob.run).not.toHaveBeenCalled();
 });

 test('throws 400 if pdfBuffer missing', async () => {
 await expect(
 createJob({ branchId: BRANCH, metadata: {}, clientId: 'c' })
 ).rejects.toMatchObject({ status: 400, message: /pdf file is required/ });
 expect(fs.writeFileSync).not.toHaveBeenCalled();
 expect(stmts.insertJob.run).not.toHaveBeenCalled();
 });

 test('throws 400 if pdfBuffer is empty', async () => {
 await expect(
 createJob({ branchId: BRANCH, pdfBuffer: Buffer.alloc(0), metadata: {}, clientId: 'c' })
 ).rejects.toMatchObject({ status: 400, message: /pdf file is required/ });
 });

 test('throws 400 if pdfBuffer is not a Buffer (string)', async () => {
 await expect(
 createJob({ branchId: BRANCH, pdfBuffer: 'not-a-buffer', metadata: {}, clientId: 'c' })
 ).rejects.toMatchObject({ status: 400, message: /pdf file is required/ });
 });

 test('throws 404 if branch not found', async () => {
 stmts.getBranchById.get.mockResolvedValue(null);
 await expect(
 createJob({ branchId: 'br_missing', pdfBuffer: VALID_PDF_BUF, metadata: {}, clientId: 'c' })
 ).rejects.toMatchObject({ status: 404, message: /Branch 'br_missing' not found/ });
 expect(fs.writeFileSync).not.toHaveBeenCalled();
 expect(stmts.insertJob.run).not.toHaveBeenCalled();
 });

 test('throws 400 if PDF missing %PDF- magic bytes', async () => {
 const badBuf = Buffer.from('not a pdf at all');
 await expect(
 createJob({ branchId: BRANCH, pdfBuffer: badBuf, metadata: {}, clientId: 'c' })
 ).rejects.toMatchObject({ status: 400, message: /Invalid PDF/ });
 expect(fs.writeFileSync).not.toHaveBeenCalled();
 expect(stmts.insertJob.run).not.toHaveBeenCalled();
 });

 test('printer undefined → inserted as null', async () => {
 await createJob({ branchId: BRANCH, pdfBuffer: VALID_PDF_BUF, metadata: {}, clientId: 'c' });
 expect(stmts.insertJob.run.mock.calls[0][0].printer).toBeNull();
 });

 test('metadata undefined → stored as "{}"', async () => {
 await createJob({ branchId: BRANCH, printer: 'p', pdfBuffer: VALID_PDF_BUF, clientId: 'c' });
 expect(stmts.insertJob.run.mock.calls[0][0].metadata).toBe('{}');
 });

 test('clientId undefined → stored as null', async () => {
 await createJob({ branchId: BRANCH, pdfBuffer: VALID_PDF_BUF, metadata: {} });
 expect(stmts.insertJob.run.mock.calls[0][0].client_id).toBeNull();
 });

 test('MQTT publish fails → still returns queued, markJobSent NOT called', async () => {
 mqttClient.publishJob.mockRejectedValue(new Error('broker down'));

 const result = await createJob({
 branchId: BRANCH,
 pdfBuffer: VALID_PDF_BUF,
 metadata: {},
 clientId: 'c',
 });

 expect(result.status).toBe('queued');
 expect(stmts.insertJob.run).toHaveBeenCalledTimes(1);
 expect(stmts.markJobSent.run).not.toHaveBeenCalled();
 });
 });

 describe('getJob', () => {
 test('throws 404 if job not found', async () => {
 stmts.getJobById.get.mockResolvedValue(null);
 await expect(getJob('job_missing')).rejects.toBeInstanceOf(HttpError);
 });

 test('returns row with metadata parsed to object', async () => {
 stmts.getJobById.get.mockResolvedValue({
 id: 'job_1',
 status: 'printed',
 metadata: '{"user_id":"EMP-1","note":"contract"}',
 });
 const job = await getJob('job_1');
 expect(job.id).toBe('job_1');
 expect(job.metadata).toEqual({ user_id: 'EMP-1', note: 'contract' });
 });

 test('malformed metadata JSON → stays as raw string, no throw', async () => {
 stmts.getJobById.get.mockResolvedValue({
 id: 'job_1',
 status: 'printed',
 metadata: '{not valid json',
 });
 const job = await getJob('job_1');
 expect(job.metadata).toBe('{not valid json');
 });
 });

 describe('listPendingForBranch', () => {
 test('returns empty array when no jobs', async () => {
 stmts.listPendingJobsByBranch.all.mockResolvedValue([]);
 await expect(listPendingForBranch(BRANCH)).resolves.toEqual([]);
 });

 test('parses metadata per item, malformed → raw string', async () => {
 stmts.listPendingJobsByBranch.all.mockResolvedValue([
 { id: 'job_1', metadata: '{"k":1}' },
 { id: 'job_2', metadata: 'oops' },
 ]);
 const result = await listPendingForBranch(BRANCH);
 expect(result[0].metadata).toEqual({ k: 1 });
 expect(result[1].metadata).toBe('oops');
 });
 });

 describe('listAllJobs', () => {
 test('returns empty array when no jobs', async () => {
 stmts.listJobs.all.mockResolvedValue([]);
 await expect(listAllJobs()).resolves.toEqual([]);
 });

 test('parses metadata per item', async () => {
 stmts.listJobs.all.mockResolvedValue([
 { id: 'job_1', metadata: '{"k":1}' },
 { id: 'job_2', metadata: null },
 ]);
 const result = await listAllJobs();
 expect(result[0].metadata).toEqual({ k: 1 });
 expect(result[1].metadata).toBeNull();
 });
 });

 describe('updateJobStatus', () => {
 const existingJob = { id: 'job_1', branch_id: BRANCH, status: 'sent' };

 test('status="printed" → markJobPrinted + updateBranchStatus, returns ok', async () => {
 stmts.getJobById.get.mockResolvedValue(existingJob);
 const result = await updateJobStatus('job_1', BRANCH, 'printed', undefined);
 expect(stmts.markJobPrinted.run).toHaveBeenCalledTimes(1);
 expect(stmts.markJobPrinted.run.mock.calls[0][0].id).toBe('job_1');
 expect(typeof stmts.markJobPrinted.run.mock.calls[0][0].printed_at).toBe('number');
 expect(stmts.markJobFailed.run).not.toHaveBeenCalled();
 expect(stmts.updateBranchStatus.run).toHaveBeenCalledWith(
 expect.objectContaining({ status: 'online', id: BRANCH })
 );
 expect(result).toEqual({ ok: true });
 });

 test('status="failed" → markJobFailed with error message', async () => {
 stmts.getJobById.get.mockResolvedValue(existingJob);
 await updateJobStatus('job_1', BRANCH, 'failed', 'paper jam');
 expect(stmts.markJobFailed.run).toHaveBeenCalledTimes(1);
 const arg = stmts.markJobFailed.run.mock.calls[0][0];
 expect(arg.id).toBe('job_1');
 expect(arg.error).toBe('paper jam');
 expect(typeof arg.failed_at).toBe('number');
 expect(stmts.markJobPrinted.run).not.toHaveBeenCalled();
 });

 test('status="failed" with no errorMessage → stored as "unknown"', async () => {
 stmts.getJobById.get.mockResolvedValue(existingJob);
 await updateJobStatus('job_1', BRANCH, 'failed', undefined);
 expect(stmts.markJobFailed.run.mock.calls[0][0].error).toBe('unknown');
 });

 test('invalid status → 400, no DB writes', async () => {
 stmts.getJobById.get.mockResolvedValue(existingJob);
 await expect(updateJobStatus('job_1', BRANCH, 'pending', undefined)).rejects.toThrow(
 /status must be/
 );
 expect(stmts.markJobPrinted.run).not.toHaveBeenCalled();
 expect(stmts.markJobFailed.run).not.toHaveBeenCalled();
 });

 test('job not found → 404', async () => {
 stmts.getJobById.get.mockResolvedValue(null);
 await expect(updateJobStatus('job_missing', BRANCH, 'printed', undefined)).rejects.toThrow(
 /Job not found/
 );
 expect(stmts.markJobPrinted.run).not.toHaveBeenCalled();
 });

 test('branch mismatch → 403, no status update, no branch update', async () => {
 stmts.getJobById.get.mockResolvedValue(existingJob);
 await expect(updateJobStatus('job_1', 'br_OTHER', 'printed', undefined)).rejects.toThrow(
 /Branch mismatch/
 );
 expect(stmts.markJobPrinted.run).not.toHaveBeenCalled();
 expect(stmts.markJobFailed.run).not.toHaveBeenCalled();
 expect(stmts.updateBranchStatus.run).not.toHaveBeenCalled();
 });
 });

 describe('getJobFileForAgent', () => {
 test('happy path: status=pending, file exists → returns absolutePath + fileSize', async () => {
 stmts.getJobById.get.mockResolvedValue({
 id: 'job_1',
 branch_id: BRANCH,
 status: 'pending',
 file_path: '/opt/storage/job_1.pdf',
 });
 fs.statSync.mockReturnValue({ size: 12345 });
 const result = await getJobFileForAgent('job_1', BRANCH);
 expect(result.absolutePath).toBe('/opt/storage/job_1.pdf');
 expect(result.fileSize).toBe(12345);
 });

 test('status=sent is also downloadable', async () => {
 stmts.getJobById.get.mockResolvedValue({
 id: 'job_1',
 branch_id: BRANCH,
 status: 'sent',
 file_path: '/p.pdf',
 });
 const result = await getJobFileForAgent('job_1', BRANCH);
 expect(result.absolutePath).toBe('/p.pdf');
 });

 test('job not found → 404', async () => {
 stmts.getJobById.get.mockResolvedValue(null);
 await expect(getJobFileForAgent('job_x', BRANCH)).rejects.toBeInstanceOf(HttpError);
 });

 test('branch mismatch → 403', async () => {
 stmts.getJobById.get.mockResolvedValue({
 id: 'job_1',
 branch_id: BRANCH,
 status: 'pending',
 file_path: '/p.pdf',
 });
 await expect(getJobFileForAgent('job_1', 'br_OTHER')).rejects.toThrow(/Branch mismatch/);
 });

 test('status=printed → 410 Gone', async () => {
 stmts.getJobById.get.mockResolvedValue({
 id: 'job_1',
 branch_id: BRANCH,
 status: 'printed',
 file_path: '/p.pdf',
 });
 await expect(getJobFileForAgent('job_1', BRANCH)).rejects.toThrow(/no longer available/);
 });

 test('file missing on disk → 404', async () => {
 stmts.getJobById.get.mockResolvedValue({
 id: 'job_1',
 branch_id: BRANCH,
 status: 'pending',
 file_path: '/p.pdf',
 });
 fs.existsSync.mockReturnValue(false);
 await expect(getJobFileForAgent('job_1', BRANCH)).rejects.toThrow(/PDF file missing/);
 });
 });
});
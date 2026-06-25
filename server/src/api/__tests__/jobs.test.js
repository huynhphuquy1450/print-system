'use strict';

// Tests cho POST /api/print-jobs — bắt buộc metadata.user_id (audit log, §10.1 #6).
// Mock auth/rate-limit/job-service quanh route; dùng multer THẬT để nhận multipart.

jest.mock('../../middleware/auth', () => ({
 verifyClient: (req, _res, next) => { req.client = { id: 'client_001' }; next(); },
 verifyAgent: (req, _res, next) => next(),
}));

jest.mock('../../middleware/rate-limit-client', () => ({
 clientRateLimit: () => (req, _res, next) => next(),
}));

jest.mock('../../services/job-service', () => ({ createJob: jest.fn() }));

const express = require('express');
const request = require('supertest');
const jobService = require('../../services/job-service');
const jobsRouter = require('../jobs');

const app = express();
app.use(express.json());
app.use('/api/print-jobs', jobsRouter);

// Catch-all error handler để lỗi không bị nuốt im lặng
app.use((err, req, res, _next) => {
 res.status(500).json({ error: err.message });
});

const PDF_BUF = Buffer.from('%PDF-1.4 test');

describe('POST /api/print-jobs', () => {
 beforeEach(() => {
 jest.clearAllMocks();
 jobService.createJob.mockResolvedValue({ job_id: 'job_1', status: 'queued' });
 });

 test('thiếu metadata.user_id: 400, không gọi createJob', async () => {
 const res = await request(app)
 .post('/api/print-jobs')
 .field('branch_id', 'br_001')
 .field('metadata', JSON.stringify({}))
 .attach('pdf', PDF_BUF, { filename: 'x.pdf', contentType: 'application/pdf' });

 expect(res.status).toBe(400);
 expect(res.body.error).toBe('Validation failed');
 expect(res.body.details).toContain('metadata.user_id is required');
 expect(jobService.createJob).not.toHaveBeenCalled();
 });

 test('không truyền metadata: 400 (user_id bắt buộc)', async () => {
 const res = await request(app)
 .post('/api/print-jobs')
 .field('branch_id', 'br_001')
 .attach('pdf', PDF_BUF, { filename: 'x.pdf', contentType: 'application/pdf' });

 expect(res.status).toBe(400);
 expect(res.body.details).toContain('metadata.user_id is required');
 expect(jobService.createJob).not.toHaveBeenCalled();
 });

 test('có metadata.user_id: 201, gọi createJob với user_id', async () => {
 const res = await request(app)
 .post('/api/print-jobs')
 .field('branch_id', 'br_001')
 .field('printer', 'hp-laserjet')
 .field('metadata', JSON.stringify({ user_id: 'EMP-1' }))
 .attach('pdf', PDF_BUF, { filename: 'x.pdf', contentType: 'application/pdf' });

 expect(res.status).toBe(201);
 expect(res.body.job_id).toBe('job_1');
 expect(jobService.createJob).toHaveBeenCalledTimes(1);
 const arg = jobService.createJob.mock.calls[0][0];
 expect(arg.branchId).toBe('br_001');
 expect(arg.metadata).toEqual({ user_id: 'EMP-1' });
 expect(arg.clientId).toBe('client_001');
 });
});

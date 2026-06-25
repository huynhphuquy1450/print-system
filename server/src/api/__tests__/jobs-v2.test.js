'use strict';

// HM3 — route v2 print-jobs (list filter + retry). Mock auth/rate-limit/job-service.
jest.mock('../../middleware/auth', () => ({
  verifyClient: (req, _res, next) => { req.client = { id: 'client_001' }; next(); },
  verifyAgent: (req, _res, next) => next(),
}));

jest.mock('../../middleware/rate-limit-client', () => ({
  clientRateLimit: () => (req, _res, next) => next(),
  bulkRateLimit: () => (req, _res, next) => next(),
}));

jest.mock('../../services/job-service', () => ({
  listJobsFiltered: jest.fn(),
  retryJob: jest.fn(),
  createJobsBulk: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const jobService = require('../../services/job-service');
const jobsV2Router = require('../jobs-v2');

const app = express();
app.use(express.json());
app.use('/api/v2/print-jobs', jobsV2Router);
app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

beforeEach(() => jest.clearAllMocks());

describe('GET /api/v2/print-jobs (HM3)', () => {
  test('truyền filter qua query → gọi listJobsFiltered với tham số parse', async () => {
    jobService.listJobsFiltered.mockResolvedValue({ jobs: [], total: 0, limit: 10, offset: 0 });
    const res = await request(app)
      .get('/api/v2/print-jobs')
      .query({ branch_id: 'br_1', status: 'failed', from: '1000', to: '2000', limit: '10' });

    expect(res.status).toBe(200);
    const arg = jobService.listJobsFiltered.mock.calls[0][0];
    expect(arg).toMatchObject({ clientId: 'client_001', branchId: 'br_1', status: 'failed', from: 1000, to: 2000, limit: '10' });
  });

  test('from không phải số → 400, không gọi service', async () => {
    const res = await request(app).get('/api/v2/print-jobs').query({ from: 'abc' });
    expect(res.status).toBe(400);
    expect(jobService.listJobsFiltered).not.toHaveBeenCalled();
  });
});

describe('POST /api/v2/print-jobs/:id/retry (HM3)', () => {
  test('gọi retryJob, trả kết quả', async () => {
    jobService.retryJob.mockResolvedValue({ ok: true, job_id: 'jX', status: 'sent' });
    const res = await request(app).post('/api/v2/print-jobs/jX/retry');
    expect(res.status).toBe(200);
    expect(jobService.retryJob).toHaveBeenCalledWith('jX', 'client_001');
    expect(res.body).toMatchObject({ ok: true, status: 'sent' });
  });

  test('retryJob ném 410 (file cleanup) → propagate status', async () => {
    const err = Object.assign(new Error('gone'), { status: 410 });
    jobService.retryJob.mockRejectedValue(err);
    const res = await request(app).post('/api/v2/print-jobs/jX/retry');
    expect(res.status).toBe(410);
  });
});

describe('POST /api/v2/print-jobs/bulk (HM7)', () => {
  const PDF = Buffer.from('%PDF-1.4 x');

  test('tất cả OK → 201, gọi createJobsBulk với items/files khớp', async () => {
    jobService.createJobsBulk.mockResolvedValue({
      created: [{ index: 0, job_id: 'j0' }, { index: 1, job_id: 'j1' }],
      failed: [],
    });
    const items = [
      { branch_id: 'br_1', metadata: { user_id: 'u1' } },
      { branch_id: 'br_2', metadata: { user_id: 'u2' } },
    ];
    const res = await request(app)
      .post('/api/v2/print-jobs/bulk')
      .field('items', JSON.stringify(items))
      .attach('pdf', PDF, { filename: 'a.pdf', contentType: 'application/pdf' })
      .attach('pdf', PDF, { filename: 'b.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.created).toHaveLength(2);
    const arg = jobService.createJobsBulk.mock.calls[0][0];
    expect(arg.items).toHaveLength(2);
    expect(arg.files).toHaveLength(2);
    expect(arg.clientId).toBe('client_001');
  });

  test('có item lỗi → 207 (partial)', async () => {
    jobService.createJobsBulk.mockResolvedValue({
      created: [{ index: 0, job_id: 'j0' }],
      failed: [{ index: 1, error: 'metadata.user_id is required' }],
    });
    const items = [{ branch_id: 'br_1', metadata: { user_id: 'u1' } }, { branch_id: 'br_2', metadata: {} }];
    const res = await request(app)
      .post('/api/v2/print-jobs/bulk')
      .field('items', JSON.stringify(items))
      .attach('pdf', PDF, { filename: 'a.pdf', contentType: 'application/pdf' })
      .attach('pdf', PDF, { filename: 'b.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(207);
    expect(res.body.failed).toHaveLength(1);
  });

  test('số items ≠ số file → 400, không gọi service', async () => {
    const items = [{ branch_id: 'br_1', metadata: { user_id: 'u1' } }];
    const res = await request(app)
      .post('/api/v2/print-jobs/bulk')
      .field('items', JSON.stringify(items))
      .attach('pdf', PDF, { filename: 'a.pdf', contentType: 'application/pdf' })
      .attach('pdf', PDF, { filename: 'b.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(jobService.createJobsBulk).not.toHaveBeenCalled();
  });

  test('không có file → 400', async () => {
    const res = await request(app)
      .post('/api/v2/print-jobs/bulk')
      .field('items', '[]');
    expect(res.status).toBe(400);
  });
});

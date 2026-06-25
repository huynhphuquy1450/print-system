'use strict';

// HM3 — route v2 print-jobs (list filter + retry). Mock auth/rate-limit/job-service.
jest.mock('../../middleware/auth', () => ({
  verifyClient: (req, _res, next) => { req.client = { id: 'client_001' }; next(); },
  verifyAgent: (req, _res, next) => next(),
}));

jest.mock('../../middleware/rate-limit-client', () => ({
  clientRateLimit: () => (req, _res, next) => next(),
}));

jest.mock('../../services/job-service', () => ({
  listJobsFiltered: jest.fn(),
  retryJob: jest.fn(),
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
    expect(arg).toMatchObject({ branchId: 'br_1', status: 'failed', from: 1000, to: 2000, limit: '10' });
  });
});

describe('POST /api/v2/print-jobs/:id/retry (HM3)', () => {
  test('gọi retryJob, trả kết quả', async () => {
    jobService.retryJob.mockResolvedValue({ ok: true, job_id: 'jX', status: 'sent' });
    const res = await request(app).post('/api/v2/print-jobs/jX/retry');
    expect(res.status).toBe(200);
    expect(jobService.retryJob).toHaveBeenCalledWith('jX');
    expect(res.body).toMatchObject({ ok: true, status: 'sent' });
  });

  test('retryJob ném 410 (file cleanup) → propagate status', async () => {
    const err = Object.assign(new Error('gone'), { status: 410 });
    jobService.retryJob.mockRejectedValue(err);
    const res = await request(app).post('/api/v2/print-jobs/jX/retry');
    expect(res.status).toBe(410);
  });
});

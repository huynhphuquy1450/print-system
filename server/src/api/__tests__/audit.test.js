'use strict';

// HM5 — route GET /api/v2/audit-log: scope theo client JWT + validate from/to.
jest.mock('../../middleware/auth', () => ({
  verifyClient: (req, _res, next) => { req.client = { id: 'cl_1' }; next(); },
  verifyAgent: (req, _res, next) => next(),
}));
jest.mock('../../services/audit-service', () => ({ list: jest.fn() }));

const express = require('express');
const request = require('supertest');
const auditService = require('../../services/audit-service');
const auditRouter = require('../audit');

const app = express();
app.use(express.json());
app.use('/api/v2/audit-log', auditRouter);
app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

beforeEach(() => jest.clearAllMocks());

describe('GET /api/v2/audit-log', () => {
  test('luôn scope theo clientId của JWT (tenant isolation)', async () => {
    auditService.list.mockResolvedValue({ entries: [], total: 0, limit: 50, offset: 0 });
    const res = await request(app).get('/api/v2/audit-log').query({ action: 'auth.login', from: '1000' });
    expect(res.status).toBe(200);
    expect(auditService.list.mock.calls[0][0]).toMatchObject({ clientId: 'cl_1', action: 'auth.login', from: 1000 });
  });

  test('from không phải số → 400, không gọi service', async () => {
    const res = await request(app).get('/api/v2/audit-log').query({ from: 'xyz' });
    expect(res.status).toBe(400);
    expect(auditService.list).not.toHaveBeenCalled();
  });
});

'use strict';

// HM — route GET /api/v2/alerts: scope theo client JWT + validate from/to.
jest.mock('../../middleware/auth', () => ({
  verifyClient: (req, _res, next) => { req.client = { id: 'cl_1' }; next(); },
  verifyAgent: (req, _res, next) => next(),
}));
jest.mock('../../services/alert-service', () => ({ list: jest.fn() }));

const express = require('express');
const request = require('supertest');
const alertService = require('../../services/alert-service');
const alertsRouter = require('../alerts');

const app = express();
app.use(express.json());
app.use('/api/v2/alerts', alertsRouter);
app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

beforeEach(() => jest.clearAllMocks());

describe('GET /api/v2/alerts', () => {
  test('luôn scope theo clientId của JWT (tenant isolation)', async () => {
    alertService.list.mockResolvedValue({ alerts: [], total: 0, limit: 50, offset: 0 });
    const res = await request(app).get('/api/v2/alerts').query({ alert_type: 'branch_offline', from: '1000' });
    expect(res.status).toBe(200);
    expect(alertService.list.mock.calls[0][0]).toMatchObject({ clientId: 'cl_1', alertType: 'branch_offline', from: 1000 });
  });

  test('map đúng query params sang list()', async () => {
    alertService.list.mockResolvedValue({ alerts: [{ id: 1 }], total: 1, limit: 10, offset: 5 });
    const res = await request(app)
      .get('/api/v2/alerts')
      .query({ alert_type: 'printer_offline', branch_id: 'br_x', from: '1000', to: '2000', limit: '10', offset: '5' });
    expect(res.status).toBe(200);
    expect(alertService.list.mock.calls[0][0]).toMatchObject({
      clientId: 'cl_1',
      alertType: 'printer_offline',
      branchId: 'br_x',
      from: 1000,
      to: 2000,
      limit: '10',
      offset: '5',
    });
    expect(res.body).toEqual({ alerts: [{ id: 1 }], total: 1, limit: 10, offset: 5 });
  });

  test('from không phải số → 400, không gọi service', async () => {
    const res = await request(app).get('/api/v2/alerts').query({ from: 'xyz' });
    expect(res.status).toBe(400);
    expect(alertService.list).not.toHaveBeenCalled();
  });

  test('to không phải số → 400, không gọi service', async () => {
    const res = await request(app).get('/api/v2/alerts').query({ to: 'abc' });
    expect(res.status).toBe(400);
    expect(alertService.list).not.toHaveBeenCalled();
  });

  test('không có filter → trả kết quả mock đúng shape', async () => {
    alertService.list.mockResolvedValue({ alerts: [], total: 0, limit: 50, offset: 0 });
    const res = await request(app).get('/api/v2/alerts');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ alerts: [], total: 0, limit: 50, offset: 0 });
    expect(alertService.list.mock.calls[0][0]).toMatchObject({ clientId: 'cl_1' });
  });
});

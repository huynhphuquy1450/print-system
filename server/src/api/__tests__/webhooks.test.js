'use strict';

// HM4 — route webhooks CRUD. Mock auth + db stmts.
jest.mock('../../middleware/auth', () => ({
  verifyClient: (req, _res, next) => { req.client = { id: 'cl_1' }; next(); },
  verifyAgent: (req, _res, next) => next(),
}));

jest.mock('../../db', () => ({
  stmts: {
    insertWebhook: { run: jest.fn() },
    listWebhooksByClient: { all: jest.fn() },
    deleteWebhook: { run: jest.fn() },
  },
}));

const express = require('express');
const request = require('supertest');
const { stmts } = require('../../db');
const webhooksRouter = require('../webhooks');

const app = express();
app.use(express.json());
app.use('/api/v2/webhooks', webhooksRouter);
app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

beforeEach(() => jest.clearAllMocks());

describe('POST /api/v2/webhooks', () => {
  test('url hợp lệ → 201, trả secret 1 lần, insert đúng client', async () => {
    stmts.insertWebhook.run.mockResolvedValue({ rowCount: 1 });
    const res = await request(app).post('/api/v2/webhooks').send({ url: 'https://erp.example/cb' });

    expect(res.status).toBe(201);
    expect(res.body.secret).toBeDefined();
    expect(res.body.events).toBe('job.status');
    expect(stmts.insertWebhook.run).toHaveBeenCalledTimes(1);
    expect(stmts.insertWebhook.run.mock.calls[0][0]).toMatchObject({
      client_id: 'cl_1', url: 'https://erp.example/cb',
    });
  });

  test('url sai scheme → 400, không insert', async () => {
    const res = await request(app).post('/api/v2/webhooks').send({ url: 'ftp://bad/x' });
    expect(res.status).toBe(400);
    expect(stmts.insertWebhook.run).not.toHaveBeenCalled();
  });

  test('thiếu url → 400 (validate)', async () => {
    const res = await request(app).post('/api/v2/webhooks').send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v2/webhooks', () => {
  test('list KHÔNG trả secret', async () => {
    stmts.listWebhooksByClient.all.mockResolvedValue([
      { id: 'wh_1', url: 'https://a/cb', secret: 'TOP', events: 'job.status', is_active: 1, created_at: 1 },
    ]);
    const res = await request(app).get('/api/v2/webhooks');
    expect(res.status).toBe(200);
    expect(res.body.webhooks[0]).not.toHaveProperty('secret');
    expect(res.body.webhooks[0].id).toBe('wh_1');
  });
});

describe('DELETE /api/v2/webhooks/:id', () => {
  test('xóa được → ok', async () => {
    stmts.deleteWebhook.run.mockResolvedValue({ rowCount: 1 });
    const res = await request(app).delete('/api/v2/webhooks/wh_1');
    expect(res.status).toBe(200);
    expect(stmts.deleteWebhook.run).toHaveBeenCalledWith({ id: 'wh_1', client_id: 'cl_1' });
  });

  test('không tồn tại (của client) → 404', async () => {
    stmts.deleteWebhook.run.mockResolvedValue({ rowCount: 0 });
    const res = await request(app).delete('/api/v2/webhooks/wh_x');
    expect(res.status).toBe(404);
  });
});

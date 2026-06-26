'use strict';

// Tests cho router /api/v2/clients — mock verifyClient + clientService để cô lập route.

jest.mock('../../middleware/auth', () => ({
  verifyClient: (req, _res, next) => {
    req.client = { id: 'cli_self', name: 'HQ' };
    next();
  },
  verifyAgent: (req, _res, next) => next(),
}));

const mockCreate = jest.fn();
const mockList = jest.fn();
const mockSetActive = jest.fn();
const mockRotateSecret = jest.fn();

jest.mock('../../services/client-service', () => ({
  create: (...args) => mockCreate(...args),
  list: (...args) => mockList(...args),
  setActive: (...args) => mockSetActive(...args),
  rotateSecret: (...args) => mockRotateSecret(...args),
}));

const express = require('express');
const request = require('supertest');
const clientsRouter = require('../clients');

const app = express();
app.use(express.json());
app.use('/api/v2/clients', clientsRouter);
app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/v2/clients', () => {
  test('tạo client mới → 201, có field id/name/secret/is_active, không lộ secret_hash', async () => {
    mockCreate.mockResolvedValue({ id: 'cli_abc123', name: 'NewCo', secret: 'plaintext_secret', is_active: 1 });

    const res = await request(app)
      .post('/api/v2/clients')
      .send({ name: 'NewCo' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('cli_abc123');
    expect(res.body.name).toBe('NewCo');
    expect(res.body.secret).toBe('plaintext_secret');
    expect(res.body.is_active).toBe(1);
    expect(res.body.secret_hash).toBeUndefined();
    expect(mockCreate).toHaveBeenCalledWith('NewCo');
  });

  test('trùng name → 409', async () => {
    const dupErr = new Error('duplicate');
    dupErr.code = '23505';
    mockCreate.mockRejectedValue(dupErr);

    const res = await request(app)
      .post('/api/v2/clients')
      .send({ name: 'DupCo' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/DupCo/);
  });

  test('thiếu name → 400 validation', async () => {
    const res = await request(app)
      .post('/api/v2/clients')
      .send({});

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('GET /api/v2/clients', () => {
  test('list → 200 mảng clients', async () => {
    mockList.mockResolvedValue([
      { id: 'cli_a', name: 'A', is_active: 1, created_at: 1000, branch_count: 2 },
      { id: 'cli_b', name: 'B', is_active: 0, created_at: 900, branch_count: 0 },
    ]);

    const res = await request(app).get('/api/v2/clients');

    expect(res.status).toBe(200);
    expect(res.body.clients).toHaveLength(2);
    expect(res.body.clients[0].branch_count).toBe(2);
    expect(res.body.clients[1].is_active).toBe(0);
  });
});

describe('PATCH /api/v2/clients/:id', () => {
  test('is_active=0 client khác → 200', async () => {
    mockSetActive.mockResolvedValue({ id: 'cli_other', is_active: 0 });

    const res = await request(app)
      .patch('/api/v2/clients/cli_other')
      .send({ is_active: 0 });

    expect(res.status).toBe(200);
    expect(res.body.is_active).toBe(0);
  });

  test('is_active=0 chính cli_self → 400 (tự khóa)', async () => {
    const res = await request(app)
      .patch('/api/v2/clients/cli_self')
      .send({ is_active: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tự vô hiệu hóa/);
    expect(mockSetActive).not.toHaveBeenCalled();
  });

  test('is_active giá trị không hợp lệ → 400', async () => {
    const res = await request(app)
      .patch('/api/v2/clients/cli_other')
      .send({ is_active: 2 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/0 hoặc 1/);
  });

  test('id không tồn tại → 404', async () => {
    mockSetActive.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/v2/clients/cli_ghost')
      .send({ is_active: 1 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/không tồn tại/);
  });
});

describe('POST /api/v2/clients/:id/rotate-secret', () => {
  test('rotate-secret → 200 có field secret mới', async () => {
    mockRotateSecret.mockResolvedValue({ id: 'cli_abc', secret: 'new_secret_value' });

    const res = await request(app)
      .post('/api/v2/clients/cli_abc/rotate-secret');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('cli_abc');
    expect(res.body.secret).toBe('new_secret_value');
  });

  test('rotate id không tồn tại → 404', async () => {
    mockRotateSecret.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v2/clients/cli_ghost/rotate-secret');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/không tồn tại/);
  });
});

'use strict';

// HM6 — API versioning khung back-compat.
// Đảm bảo endpoint hiện hữu phục vụ qua cả /api/v1/* và alias /api/* (cùng handler),
// và /api/v2 tồn tại (khung rỗng). Dùng endpoint trả 401 trước khi chạm DB nên không
// cần mock DB/MQTT — chỉ cần env giả từ jest.setup.js.

const request = require('supertest');
const app = require('../../app');

describe('API versioning (HM6)', () => {
  test('GET /api/v1/print-jobs/:id và alias /api/print-jobs/:id cùng yêu cầu auth (401)', async () => {
    const v1 = await request(app).get('/api/v1/print-jobs/job_x');
    const alias = await request(app).get('/api/print-jobs/job_x');
    expect(v1.status).toBe(401);
    expect(alias.status).toBe(401);
    expect(alias.body).toEqual(v1.body);
  });

  test('POST /api/v1/auth/login và alias /api/auth/login cùng route (không 404)', async () => {
    const v1 = await request(app).post('/api/v1/auth/login').send({});
    const alias = await request(app).post('/api/auth/login').send({});
    expect(v1.status).not.toBe(404);
    expect(alias.status).toBe(v1.status);
  });

  test('/api/v2 tồn tại nhưng chưa có route → 404 từ app (không phải lỗi mount)', async () => {
    const res = await request(app).get('/api/v2/print-jobs/job_x');
    expect(res.status).toBe(404);
  });

  test('health vẫn hoạt động ngoài namespace /api', async () => {
    const res = await request(app).get('/health');
    expect([200, 503]).toContain(res.status);
  });
});

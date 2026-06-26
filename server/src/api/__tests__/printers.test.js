'use strict';

// Tests cho POST /api/printers/heartbeat (verifyAgent).
// Mock auth middleware + db để tránh kết nối PostgreSQL thật.

const mockVerifyAgent = jest.fn((req, _res, next) => {
 req.agent = { branchId: 'br_001', branchName: 'Test Branch' };
 next();
});

jest.mock('../../middleware/auth', () => ({
 verifyClient: (req, _res, next) => next(),
 verifyAgent: (...args) => mockVerifyAgent(...args),
}));

const mockRunFn = jest.fn();

jest.mock('../../db', () => ({
 stmts: {
 listPrintersByBranch: { all: jest.fn() },
 getBranchById: { get: jest.fn() },
 insertPrinter: { run: jest.fn() },
 getPrinterById: { get: jest.fn() },
 deletePrinter: { run: jest.fn() },
 updatePrinterStatus: { run: mockRunFn },
 },
 db: {},
}));

const express = require('express');
const request = require('supertest');
const printersRouter = require('../printers');

const app = express();
app.use(express.json());
app.use('/api/printers', printersRouter);
app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

beforeEach(() => {
 jest.clearAllMocks();
 mockVerifyAgent.mockImplementation((req, _res, next) => {
 req.agent = { branchId: 'br_001', branchName: 'Test Branch' };
 next();
 });
});

describe('POST /api/printers/heartbeat', () => {
 test('agent hợp lệ → cập nhật đúng status, trả updated count', async () => {
 mockRunFn
 .mockResolvedValueOnce({ rowCount: 1 })
 .mockResolvedValueOnce({ rowCount: 1 });

 const res = await request(app)
 .post('/api/printers/heartbeat')
 .set('X-Agent-Token', 'token')
 .set('X-Branch-Id', 'br_001')
 .send({ printers: [
 { name: 'HP-001', status: 'online' },
 { name: 'HP-002', status: 'out_of_paper' },
 ] });

 expect(res.status).toBe(200);
 expect(res.body).toEqual({ ok: true, updated: 2 });
 expect(mockRunFn).toHaveBeenCalledTimes(2);
 expect(mockRunFn).toHaveBeenCalledWith(expect.objectContaining({
 status: 'online', branch_id: 'br_001', name: 'HP-001',
 }));
 });

 test('thiếu X-Agent-Token → 401', async () => {
 mockVerifyAgent.mockImplementation((req, res, _next) => {
 res.status(401).json({ error: 'Missing X-Agent-Token' });
 });

 const res = await request(app)
 .post('/api/printers/heartbeat')
 .send({ printers: [{ name: 'HP-001', status: 'online' }] });

 expect(res.status).toBe(401);
 expect(mockRunFn).not.toHaveBeenCalled();
 });

 test('name lạ không tồn tại trong DB → updated:0, không lỗi', async () => {
 mockRunFn.mockResolvedValue({ rowCount: 0 });

 const res = await request(app)
 .post('/api/printers/heartbeat')
 .set('X-Agent-Token', 'token')
 .set('X-Branch-Id', 'br_001')
 .send({ printers: [{ name: 'ghost-printer', status: 'online' }] });

 expect(res.status).toBe(200);
 expect(res.body).toEqual({ ok: true, updated: 0 });
 });

 test('status ngoài enum → item bị bỏ qua, không gọi run', async () => {
 const res = await request(app)
 .post('/api/printers/heartbeat')
 .set('X-Agent-Token', 'token')
 .set('X-Branch-Id', 'br_001')
 .send({ printers: [{ name: 'HP-001', status: 'broken' }] });

 expect(res.status).toBe(200);
 expect(res.body).toEqual({ ok: true, updated: 0 });
 expect(mockRunFn).not.toHaveBeenCalled();
 });

 test('printers không phải mảng → 400', async () => {
 const res = await request(app)
 .post('/api/printers/heartbeat')
 .set('X-Agent-Token', 'token')
 .set('X-Branch-Id', 'br_001')
 .send({ printers: 'not-array' });

 expect(res.status).toBe(400);
 expect(res.body.error).toBe('printers must be an array');
 });
});

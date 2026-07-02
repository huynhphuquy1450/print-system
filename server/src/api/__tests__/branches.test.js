'use strict';

// Tests cho PATCH /api/v1/branches/:id (verifyClient).
// Mock auth middleware + db để tránh kết nối PostgreSQL thật.

jest.mock('../../middleware/auth', () => ({
 verifyClient: (req, _res, next) => { req.client = { id: 'c1' }; next(); },
 verifyAgent: jest.fn((_req, _res, next) => next()),
}));

jest.mock('../../db', () => ({
 stmts: {
 getBranchById: { get: jest.fn() },
 getBranchByClientAndName: { get: jest.fn(), all: jest.fn(), run: jest.fn() },
 insertBranch: { get: jest.fn(), all: jest.fn(), run: jest.fn() },
 listAllBranches: { get: jest.fn(), all: jest.fn(), run: jest.fn() },
 updateBranchToken: { get: jest.fn(), all: jest.fn(), run: jest.fn() },
 updateBranchStatus: { get: jest.fn(), all: jest.fn(), run: jest.fn() },
 updateBranch: { run: jest.fn() },
 updateBranchClient: { run: jest.fn() },
 getClientById: { get: jest.fn() },
 getBranchByTokenHash: { get: jest.fn(), all: jest.fn(), run: jest.fn() },
 },
 db: { query: jest.fn() },
}));

const express = require('express');
const request = require('supertest');
const branchesRouter = require('../branches');
const { stmts } = require('../../db');

const app = express();
app.use(express.json());
app.use('/api/v1/branches', branchesRouter);
app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

beforeEach(() => {
 jest.clearAllMocks();
});

describe('PATCH /api/v1/branches/:id', () => {
 test('200: đổi cả name và location', async () => {
 stmts.getBranchById.get.mockResolvedValue({ id: 'br_1', name: 'Cũ', location: 'HCM', client_id: 'c1' });
 stmts.updateBranch.run.mockResolvedValue({ rowCount: 1 });

 const res = await request(app)
 .patch('/api/v1/branches/br_1')
 .send({ name: 'Mới', location: 'HN' });

 expect(res.status).toBe(200);
 expect(res.body).toEqual({ id: 'br_1', name: 'Mới', location: 'HN' });
 expect(stmts.updateBranch.run).toHaveBeenCalledWith({ id: 'br_1', name: 'Mới', location: 'HN' });
 });

 test('200: chỉ đổi name → location giữ nguyên giá trị cũ', async () => {
 stmts.getBranchById.get.mockResolvedValue({ id: 'br_1', name: 'Cũ', location: 'HCM', client_id: 'c1' });
 stmts.updateBranch.run.mockResolvedValue({ rowCount: 1 });

 const res = await request(app)
 .patch('/api/v1/branches/br_1')
 .send({ name: 'Mới' });

 expect(res.status).toBe(200);
 expect(res.body.location).toBe('HCM');
 });

 test('404: getBranchById trả null', async () => {
 stmts.getBranchById.get.mockResolvedValue(null);

 const res = await request(app)
 .patch('/api/v1/branches/br_missing')
 .send({ name: 'Mới' });

 expect(res.status).toBe(404);
 expect(res.body.error).toBe('Branch not found');
 });

 test('cho phép sửa branch của client khác (không scope)', async () => {
 stmts.getBranchById.get.mockResolvedValue({ id: 'br_1', name: 'Cũ', location: 'HCM', client_id: 'c2' });
 stmts.updateBranch.run.mockResolvedValue({ rowCount: 1 });

 const res = await request(app)
 .patch('/api/v1/branches/br_1')
 .send({ name: 'Mới' });

 expect(res.status).toBe(200);
 expect(stmts.updateBranch.run).toHaveBeenCalled();
 });

 test('400: body rỗng → Cần ít nhất name hoặc location', async () => {
 stmts.getBranchById.get.mockResolvedValue({ id: 'br_1', name: 'Cũ', location: 'HCM', client_id: 'c1' });

 const res = await request(app)
 .patch('/api/v1/branches/br_1')
 .send({});

 expect(res.status).toBe(400);
 expect(res.body.error).toContain('Cần ít nhất');
 expect(stmts.updateBranch.run).not.toHaveBeenCalled();
 });

 test('400: name dài 101 ký tự → validate chặn, error Validation failed', async () => {
 stmts.getBranchById.get.mockResolvedValue({ id: 'br_1', name: 'Cũ', location: 'HCM', client_id: 'c1' });

 const res = await request(app)
 .patch('/api/v1/branches/br_1')
 .send({ name: 'a'.repeat(101) });

 expect(res.status).toBe(400);
 expect(res.body.error).toBe('Validation failed');
 });

 test('409: updateBranch rejects với code 23505 → tên trùng', async () => {
 stmts.getBranchById.get.mockResolvedValue({ id: 'br_1', name: 'Cũ', location: 'HCM', client_id: 'c1' });
 stmts.updateBranch.run.mockRejectedValue({ code: '23505' });

 const res = await request(app)
 .patch('/api/v1/branches/br_1')
 .send({ name: 'Trùng' });

 expect(res.status).toBe(409);
 expect(res.body.error).toContain('đã tồn tại');
 });
});

describe('GET /api/v1/branches', () => {
 test('200: trả toàn bộ danh sách branches (không scope client)', async () => {
 stmts.listAllBranches.all.mockResolvedValue([
 { id: 'br_1', name: 'Branch 1', location: 'HCM', status: 'offline', last_seen_at: null, created_at: 1000 },
 ]);

 const res = await request(app).get('/api/v1/branches');

 expect(res.status).toBe(200);
 expect(res.body.branches).toHaveLength(1);
 expect(stmts.listAllBranches.all).toHaveBeenCalled();
 });

 test('200: ?status=online → chỉ trả branches online', async () => {
 stmts.listAllBranches.all.mockResolvedValue([
 { id: 'br_1', name: 'Branch 1', location: 'HCM', status: 'online', last_seen_at: 1000, created_at: 1000 },
 { id: 'br_2', name: 'Branch 2', location: 'HN', status: 'offline', last_seen_at: null, created_at: 1000 },
 ]);

 const res = await request(app).get('/api/v1/branches?status=online');

 expect(res.status).toBe(200);
 expect(res.body.branches).toHaveLength(1);
 expect(res.body.branches[0].id).toBe('br_1');
 });

 test('200: ?status=offline → chỉ trả branches offline', async () => {
 stmts.listAllBranches.all.mockResolvedValue([
 { id: 'br_1', name: 'Branch 1', location: 'HCM', status: 'online', last_seen_at: 1000, created_at: 1000 },
 { id: 'br_2', name: 'Branch 2', location: 'HN', status: 'offline', last_seen_at: null, created_at: 1000 },
 ]);

 const res = await request(app).get('/api/v1/branches?status=offline');

 expect(res.status).toBe(200);
 expect(res.body.branches).toHaveLength(1);
 expect(res.body.branches[0].id).toBe('br_2');
 });

 test('400: ?status=bogus → invalid status', async () => {
 const res = await request(app).get('/api/v1/branches?status=bogus');

 expect(res.status).toBe(400);
 expect(stmts.listAllBranches.all).not.toHaveBeenCalled();
 });
});

describe('POST /api/v1/branches', () => {
 test('201: insertBranch.run được gọi với client_id của client', async () => {
 stmts.insertBranch.run.mockResolvedValue({});

 const res = await request(app)
 .post('/api/v1/branches')
 .send({ name: 'New Branch' });

 expect(res.status).toBe(201);
 expect(stmts.insertBranch.run).toHaveBeenCalledWith(
 expect.objectContaining({ client_id: 'c1' })
 );
 });
});

describe('GET /api/v1/branches/:id', () => {
 test('cho phép xem branch của client khác (không scope)', async () => {
 stmts.getBranchById.get.mockResolvedValue({ id: 'br_1', client_id: 'c2', name: 'Cũ', location: 'HCM' });

 const res = await request(app).get('/api/v1/branches/br_1');

 expect(res.status).toBe(200);
 });
});

describe('POST /api/v1/branches/:id/regen-token', () => {
 test('cho phép regen-token branch của client khác (không scope)', async () => {
 stmts.getBranchById.get.mockResolvedValue({ id: 'br_1', client_id: 'c2', name: 'Cũ' });
 stmts.updateBranchToken.run.mockResolvedValue({ rowCount: 1 });

 const res = await request(app).post('/api/v1/branches/br_1/regen-token');

 expect(res.status).toBe(200);
 expect(stmts.updateBranchToken.run).toHaveBeenCalled();
 });
});

describe('POST /api/v1/branches/:id/transfer-client', () => {
 test('200: chuyển branch sang client đích hợp lệ', async () => {
 stmts.getBranchById.get.mockResolvedValue({ id: 'br_1', name: 'Trạm', client_id: 'c1' });
 stmts.getClientById.get.mockResolvedValue({ id: 'c2', is_active: 1 });
 stmts.updateBranchClient.run.mockResolvedValue({ rowCount: 1 });

 const res = await request(app)
 .post('/api/v1/branches/br_1/transfer-client')
 .send({ target_client_id: 'c2' });

 expect(res.status).toBe(200);
 expect(res.body).toEqual({ id: 'br_1', name: 'Trạm', client_id: 'c2' });
 expect(stmts.updateBranchClient.run).toHaveBeenCalledWith({ id: 'br_1', client_id: 'c2' });
 });

 test('400: thiếu target_client_id → validate chặn', async () => {
 const res = await request(app)
 .post('/api/v1/branches/br_1/transfer-client')
 .send({});

 expect(res.status).toBe(400);
 expect(res.body.error).toBe('Validation failed');
 expect(stmts.getBranchById.get).not.toHaveBeenCalled();
 });

 test('404: branch không tồn tại', async () => {
 stmts.getBranchById.get.mockResolvedValue(null);

 const res = await request(app)
 .post('/api/v1/branches/br_missing/transfer-client')
 .send({ target_client_id: 'c2' });

 expect(res.status).toBe(404);
 expect(res.body.error).toBe('Branch not found');
 });

 test('cho phép chuyển branch của client khác (không scope)', async () => {
 stmts.getBranchById.get.mockResolvedValue({ id: 'br_1', name: 'Trạm', client_id: 'c2' });
 stmts.getClientById.get.mockResolvedValue({ id: 'c3', is_active: 1 });
 stmts.updateBranchClient.run.mockResolvedValue({ rowCount: 1 });

 const res = await request(app)
 .post('/api/v1/branches/br_1/transfer-client')
 .send({ target_client_id: 'c3' });

 expect(res.status).toBe(200);
 expect(stmts.updateBranchClient.run).toHaveBeenCalled();
 });

 test('400: chuyển sang chính client hiện tại', async () => {
 stmts.getBranchById.get.mockResolvedValue({ id: 'br_1', name: 'Trạm', client_id: 'c1' });

 const res = await request(app)
 .post('/api/v1/branches/br_1/transfer-client')
 .send({ target_client_id: 'c1' });

 expect(res.status).toBe(400);
 expect(res.body.error).toContain('đã thuộc client này');
 expect(stmts.getClientById.get).not.toHaveBeenCalled();
 });

 test('404: client đích không tồn tại', async () => {
 stmts.getBranchById.get.mockResolvedValue({ id: 'br_1', name: 'Trạm', client_id: 'c1' });
 stmts.getClientById.get.mockResolvedValue(null);

 const res = await request(app)
 .post('/api/v1/branches/br_1/transfer-client')
 .send({ target_client_id: 'c2' });

 expect(res.status).toBe(404);
 expect(res.body.error).toContain('Client đích không tồn tại');
 expect(stmts.updateBranchClient.run).not.toHaveBeenCalled();
 });

 test('400: client đích không hoạt động (is_active=0)', async () => {
 stmts.getBranchById.get.mockResolvedValue({ id: 'br_1', name: 'Trạm', client_id: 'c1' });
 stmts.getClientById.get.mockResolvedValue({ id: 'c2', is_active: 0 });

 const res = await request(app)
 .post('/api/v1/branches/br_1/transfer-client')
 .send({ target_client_id: 'c2' });

 expect(res.status).toBe(400);
 expect(res.body.error).toContain('không hoạt động');
 expect(stmts.updateBranchClient.run).not.toHaveBeenCalled();
 });

 test('409: trùng tên trạm ở client đích (23505)', async () => {
 stmts.getBranchById.get.mockResolvedValue({ id: 'br_1', name: 'Trạm', client_id: 'c1' });
 stmts.getClientById.get.mockResolvedValue({ id: 'c2', is_active: 1 });
 stmts.updateBranchClient.run.mockRejectedValue({ code: '23505' });

 const res = await request(app)
 .post('/api/v1/branches/br_1/transfer-client')
 .send({ target_client_id: 'c2' });

 expect(res.status).toBe(409);
 expect(res.body.error).toContain('đã tồn tại trong client đích');
 });
});

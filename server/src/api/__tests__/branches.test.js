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
 listBranches: { get: jest.fn(), all: jest.fn(), run: jest.fn() },
 updateBranchToken: { get: jest.fn(), all: jest.fn(), run: jest.fn() },
 updateBranchStatus: { get: jest.fn(), all: jest.fn(), run: jest.fn() },
 updateBranch: { run: jest.fn() },
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

 test('403: branch thuộc client khác', async () => {
 stmts.getBranchById.get.mockResolvedValue({ id: 'br_1', name: 'Cũ', location: 'HCM', client_id: 'c2' });

 const res = await request(app)
 .patch('/api/v1/branches/br_1')
 .send({ name: 'Mới' });

 expect(res.status).toBe(403);
 expect(stmts.updateBranch.run).not.toHaveBeenCalled();
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

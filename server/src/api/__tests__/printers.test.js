'use strict';

// Tests cho POST /api/printers/heartbeat (verifyAgent) + alert wiring (TASK 7).
// Mock auth middleware + db + alert-service để tránh kết nối PostgreSQL thật.

const mockVerifyAgent = jest.fn((req, _res, next) => {
 req.agent = { branchId: 'br_001', branchName: 'Test Branch', clientId: 'cl_001' };
 next();
});

jest.mock('../../middleware/auth', () => ({
 verifyClient: (req, _res, next) => { req.client = { id: 'cl_001' }; next(); },
 verifyAgent: (...args) => mockVerifyAgent(...args),
}));

const mockRunFn = jest.fn();
const mockInsertDiscoveredPrinter = jest.fn();
const mockSetPrinterApproved = jest.fn();
const mockSetPrinterDefault = jest.fn();
const mockGetPrinterById = jest.fn();
const mockListPrintersByBranch = jest.fn();
const mockDbQuery = jest.fn();
const mockGetPrinterByBranchAndName = jest.fn();
const mockListAllPrintersWithBranch = jest.fn();

jest.mock('../../db', () => ({
 stmts: {
 listPrintersByBranch: { all: mockListPrintersByBranch },
 listAllPrintersWithBranch: { all: mockListAllPrintersWithBranch },
 getBranchById: { get: jest.fn() },
 insertPrinter: { run: jest.fn() },
 getPrinterById: { get: mockGetPrinterById },
 deletePrinter: { run: jest.fn() },
 updatePrinterStatus: { run: mockRunFn },
 insertDiscoveredPrinter: { run: mockInsertDiscoveredPrinter },
 setPrinterApproved: { run: mockSetPrinterApproved },
 setPrinterDefault: { run: mockSetPrinterDefault },
 getPrinterByBranchAndName: { get: mockGetPrinterByBranchAndName },
 },
 db: { query: mockDbQuery },
}));

// Mock alert-service để kiểm soát alert wiring (TASK 7)
const mockAlertEmit = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/alert-service', () => ({
 emit: (...args) => mockAlertEmit(...args),
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
 req.agent = { branchId: 'br_001', branchName: 'Test Branch', clientId: 'cl_001' };
 next();
 });
 // Mặc định: máy in chưa tồn tại trong DB (sẽ bị bắt qua insertDiscoveredPrinter nếu rowCount=0)
 mockGetPrinterByBranchAndName.mockResolvedValue(null);
 mockAlertEmit.mockResolvedValue(undefined);
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
 expect(res.body).toEqual({ ok: true, updated: 2, discovered: 0 });
 expect(mockRunFn).toHaveBeenCalledTimes(2);
 expect(mockRunFn).toHaveBeenCalledWith(expect.objectContaining({
 status: 'online', branch_id: 'br_001', name: 'HP-001',
 }));
 });

 test('agent hợp lệ → status low_toner được lưu đúng', async () => {
 mockRunFn.mockResolvedValueOnce({ rowCount: 1 });

 const res = await request(app)
 .post('/api/printers/heartbeat')
 .set('X-Agent-Token', 'token')
 .set('X-Branch-Id', 'br_001')
 .send({ printers: [{ name: 'HP-001', status: 'low_toner' }] });

 expect(res.status).toBe(200);
 expect(res.body).toEqual({ ok: true, updated: 1, discovered: 0 });
 expect(mockRunFn).toHaveBeenCalledWith(expect.objectContaining({
 status: 'low_toner', branch_id: 'br_001', name: 'HP-001',
 }));
 });

 test('agent hợp lệ → status no_toner được lưu đúng', async () => {
 mockRunFn.mockResolvedValueOnce({ rowCount: 1 });

 const res = await request(app)
 .post('/api/printers/heartbeat')
 .set('X-Agent-Token', 'token')
 .set('X-Branch-Id', 'br_001')
 .send({ printers: [{ name: 'HP-001', status: 'no_toner' }] });

 expect(res.status).toBe(200);
 expect(res.body).toEqual({ ok: true, updated: 1, discovered: 0 });
 expect(mockRunFn).toHaveBeenCalledWith(expect.objectContaining({
 status: 'no_toner', branch_id: 'br_001', name: 'HP-001',
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

 test('name lạ không tồn tại trong DB → insertDiscoveredPrinter, discovered:1', async () => {
 mockRunFn.mockResolvedValue({ rowCount: 0 });
 mockInsertDiscoveredPrinter.mockResolvedValue({ rowCount: 1 });

 const res = await request(app)
 .post('/api/printers/heartbeat')
 .set('X-Agent-Token', 'token')
 .set('X-Branch-Id', 'br_001')
 .send({ printers: [{ name: 'ghost-printer', status: 'online' }] });

 expect(res.status).toBe(200);
 expect(res.body).toEqual({ ok: true, updated: 0, discovered: 1 });
 expect(mockInsertDiscoveredPrinter).toHaveBeenCalledWith(expect.objectContaining({
 branch_id: 'br_001',
 name: 'ghost-printer',
 status: 'online',
 }));
 });

 test('status ngoài enum → item bị bỏ qua, không gọi run', async () => {
 const res = await request(app)
 .post('/api/printers/heartbeat')
 .set('X-Agent-Token', 'token')
 .set('X-Branch-Id', 'br_001')
 .send({ printers: [{ name: 'HP-001', status: 'broken' }] });

 expect(res.status).toBe(200);
 expect(res.body).toEqual({ ok: true, updated: 0, discovered: 0 });
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

describe('POST /api/printers/heartbeat - máy đã tồn tại', () => {
 test('heartbeat máy đã tồn tại → updated:1, discovered:0', async () => {
 mockRunFn.mockResolvedValue({ rowCount: 1 });

 const res = await request(app)
 .post('/api/printers/heartbeat')
 .set('X-Agent-Token', 'token')
 .set('X-Branch-Id', 'br_001')
 .send({ printers: [{ name: 'HP-001', status: 'online' }] });

 expect(res.status).toBe(200);
 expect(res.body).toEqual({ ok: true, updated: 1, discovered: 0 });
 expect(mockInsertDiscoveredPrinter).not.toHaveBeenCalled();
 });
});

describe('GET /api/printers', () => {
 test('không truyền branch_id → gọi listAllPrintersWithBranch, trả printers kèm branch info', async () => {
 const rows = [
 { id: 'prn_001', branch_id: 'br_001', name: 'HP-001', status: 'online', approved: 1, branch_name: 'Branch A', branch_status: 'online' },
 { id: 'prn_002', branch_id: 'br_002', name: 'HP-002', status: 'paper_jam', approved: 1, branch_name: 'Branch B', branch_status: 'online' },
 ];
 mockListAllPrintersWithBranch.mockResolvedValue(rows);

 const res = await request(app).get('/api/printers');

 expect(res.status).toBe(200);
 expect(mockListAllPrintersWithBranch).toHaveBeenCalled();
 expect(res.body).toEqual({ printers: rows });
 });

 test('không branch_id + ?status=paper_jam → chỉ trả printer khớp status', async () => {
 const rows = [
 { id: 'prn_001', branch_id: 'br_001', name: 'HP-001', status: 'online', approved: 1, branch_name: 'Branch A', branch_status: 'online' },
 { id: 'prn_002', branch_id: 'br_002', name: 'HP-002', status: 'paper_jam', approved: 1, branch_name: 'Branch B', branch_status: 'online' },
 ];
 mockListAllPrintersWithBranch.mockResolvedValue(rows);

 const res = await request(app).get('/api/printers?status=paper_jam');

 expect(res.status).toBe(200);
 expect(res.body.printers).toEqual([rows[1]]);
 });

 test('không branch_id + ?approved=1 → chỉ trả printer approved:1', async () => {
 const rows = [
 { id: 'prn_001', branch_id: 'br_001', name: 'HP-001', status: 'online', approved: 1, branch_name: 'Branch A', branch_status: 'online' },
 { id: 'prn_002', branch_id: 'br_002', name: 'HP-002', status: 'online', approved: 0, branch_name: 'Branch B', branch_status: 'online' },
 ];
 mockListAllPrintersWithBranch.mockResolvedValue(rows);

 const res = await request(app).get('/api/printers?approved=1');

 expect(res.status).toBe(200);
 expect(res.body.printers).toEqual([rows[0]]);
 });

 test('không branch_id + ?status=bogus (ngoài enum) → 400', async () => {
 const res = await request(app).get('/api/printers?status=bogus');

 expect(res.status).toBe(400);
 expect(res.body.error).toBe('Invalid status: bogus');
 expect(mockListAllPrintersWithBranch).not.toHaveBeenCalled();
 });

 test('không branch_id + ?approved=2 (không hợp lệ) → 400', async () => {
 const res = await request(app).get('/api/printers?approved=2');

 expect(res.status).toBe(400);
 expect(res.body.error).toBe('approved must be 0 or 1');
 expect(mockListAllPrintersWithBranch).not.toHaveBeenCalled();
 });
});

describe('PATCH /api/printers/:id', () => {
 test('PATCH {approved:1} → gọi setPrinterApproved, trả printer đã cập nhật', async () => {
 const printer = { id: 'prn_001', branch_id: 'br_001', name: 'HP-001', is_default: 0, approved: 0, source: 'discovered' };
 const updated = { ...printer, approved: 1 };
 mockGetPrinterById.mockResolvedValueOnce(printer).mockResolvedValueOnce(updated);
 const { stmts: mockStmts } = require('../../db');
 mockStmts.getBranchById.get.mockResolvedValueOnce({ id: 'br_001', client_id: 'cl_001' });
 mockSetPrinterApproved.mockResolvedValue({ rowCount: 1 });

 const res = await request(app)
 .patch('/api/printers/prn_001')
 .send({ approved: 1 });

 expect(res.status).toBe(200);
 expect(res.body.approved).toBe(1);
 expect(mockSetPrinterApproved).toHaveBeenCalledWith({ id: 'prn_001', approved: 1 });
 });

 test('PATCH {is_default:1} → unset default máy khác, gọi setPrinterDefault', async () => {
 const printer = { id: 'prn_002', branch_id: 'br_001', name: 'HP-002', is_default: 0, approved: 1 };
 const otherPrinter = { id: 'prn_003', branch_id: 'br_001', name: 'HP-003', is_default: 1, approved: 1 };
 const updated = { ...printer, is_default: 1 };
 mockGetPrinterById.mockResolvedValueOnce(printer).mockResolvedValueOnce(updated);
 const { stmts: mockStmts } = require('../../db');
 mockStmts.getBranchById.get.mockResolvedValueOnce({ id: 'br_001', client_id: 'cl_001' });
 mockListPrintersByBranch.mockResolvedValue([printer, otherPrinter]);
 mockSetPrinterDefault.mockResolvedValue({ rowCount: 1 });
 mockDbQuery.mockResolvedValue({ rowCount: 1 });

 const res = await request(app)
 .patch('/api/printers/prn_002')
 .send({ is_default: 1 });

 expect(res.status).toBe(200);
 expect(mockDbQuery).toHaveBeenCalledWith(
 'UPDATE printers SET is_default = 0 WHERE id = $1',
 ['prn_003']
 );
 expect(mockSetPrinterDefault).toHaveBeenCalledWith({ id: 'prn_002', is_default: 1 });
 });

 test('PATCH printer không tồn tại → 404', async () => {
 mockGetPrinterById.mockResolvedValue(null);

 const res = await request(app)
 .patch('/api/printers/non_existent')
 .send({ approved: 1 });

 expect(res.status).toBe(404);
 expect(res.body.error).toBe('Printer not found');
 });
});

describe('POST /api/printers (manual)', () => {
 test('POST manual → response có approved:1, source:manual', async () => {
 const { stmts: mockStmts } = require('../../db');
 mockStmts.getBranchById.get.mockResolvedValue({ id: 'br_001', name: 'Branch', client_id: 'cl_001' });
 mockStmts.insertPrinter.run.mockResolvedValue({ rowCount: 1 });
 mockListPrintersByBranch.mockResolvedValue([]);

 const res = await request(app)
 .post('/api/printers')
 .send({ branch_id: 'br_001', name: 'Manual-Printer' });

 expect(res.status).toBe(201);
 expect(res.body.source).toBe('manual');
 expect(res.body.approved).toBe(1);
 expect(res.body.name).toBe('Manual-Printer');
 });
});

describe('POST /api/printers/heartbeat – alert wiring (TASK 7)', () => {
 test('printer online → out_of_paper: emit gọi 1 lần với alertType printer.out_of_paper', async () => {
 // Trạng thái cũ: online
 mockGetPrinterByBranchAndName.mockResolvedValue({ id: 'prn_001', status: 'online' });
 mockRunFn.mockResolvedValue({ rowCount: 1 });

 const res = await request(app)
 .post('/api/printers/heartbeat')
 .set('X-Agent-Token', 'token')
 .set('X-Branch-Id', 'br_001')
 .send({ printers: [{ name: 'HP-001', status: 'out_of_paper' }] });

 expect(res.status).toBe(200);
 expect(res.body).toEqual({ ok: true, updated: 1, discovered: 0 });
 expect(mockAlertEmit).toHaveBeenCalledTimes(1);
 expect(mockAlertEmit).toHaveBeenCalledWith({
 clientId: 'cl_001',
 branchId: 'br_001',
 printerId: 'prn_001',
 alertType: 'printer.out_of_paper',
 status: 'out_of_paper',
 });
 });

 test('printer out_of_paper → out_of_paper (status không đổi): emit KHÔNG gọi', async () => {
 // Trạng thái cũ đã là out_of_paper → không phát alert trùng
 mockGetPrinterByBranchAndName.mockResolvedValue({ id: 'prn_001', status: 'out_of_paper' });
 mockRunFn.mockResolvedValue({ rowCount: 1 });

 const res = await request(app)
 .post('/api/printers/heartbeat')
 .set('X-Agent-Token', 'token')
 .set('X-Branch-Id', 'br_001')
 .send({ printers: [{ name: 'HP-001', status: 'out_of_paper' }] });

 expect(res.status).toBe(200);
 expect(mockAlertEmit).not.toHaveBeenCalled();
 });

 test('printer offline → online (recovery): emit gọi alertType printer.online', async () => {
 // Trạng thái cũ: offline → đây là recovery
 mockGetPrinterByBranchAndName.mockResolvedValue({ id: 'prn_001', status: 'offline' });
 mockRunFn.mockResolvedValue({ rowCount: 1 });

 const res = await request(app)
 .post('/api/printers/heartbeat')
 .set('X-Agent-Token', 'token')
 .set('X-Branch-Id', 'br_001')
 .send({ printers: [{ name: 'HP-001', status: 'online' }] });

 expect(res.status).toBe(200);
 expect(mockAlertEmit).toHaveBeenCalledTimes(1);
 expect(mockAlertEmit).toHaveBeenCalledWith({
 clientId: 'cl_001',
 branchId: 'br_001',
 printerId: 'prn_001',
 alertType: 'printer.online',
 status: 'online',
 });
 });

 test('printer out_of_paper → online (recovery từ lỗi giấy): emit printer.online', async () => {
 mockGetPrinterByBranchAndName.mockResolvedValue({ id: 'prn_002', status: 'out_of_paper' });
 mockRunFn.mockResolvedValue({ rowCount: 1 });

 const res = await request(app)
 .post('/api/printers/heartbeat')
 .set('X-Agent-Token', 'token')
 .set('X-Branch-Id', 'br_001')
 .send({ printers: [{ name: 'HP-002', status: 'online' }] });

 expect(res.status).toBe(200);
 expect(mockAlertEmit).toHaveBeenCalledWith(expect.objectContaining({
 alertType: 'printer.online',
 printerId: 'prn_002',
 }));
 });

 test('printer online → low_toner: emit gọi 1 lần với alertType printer.low_toner', async () => {
 mockGetPrinterByBranchAndName.mockResolvedValue({ id: 'prn_001', status: 'online' });
 mockRunFn.mockResolvedValue({ rowCount: 1 });

 const res = await request(app)
 .post('/api/printers/heartbeat')
 .set('X-Agent-Token', 'token')
 .set('X-Branch-Id', 'br_001')
 .send({ printers: [{ name: 'HP-001', status: 'low_toner' }] });

 expect(res.status).toBe(200);
 expect(mockAlertEmit).toHaveBeenCalledTimes(1);
 expect(mockAlertEmit).toHaveBeenCalledWith({
 clientId: 'cl_001',
 branchId: 'br_001',
 printerId: 'prn_001',
 alertType: 'printer.low_toner',
 status: 'low_toner',
 });
 });

 test('printer online → no_toner: emit gọi 1 lần với alertType printer.no_toner', async () => {
 mockGetPrinterByBranchAndName.mockResolvedValue({ id: 'prn_001', status: 'online' });
 mockRunFn.mockResolvedValue({ rowCount: 1 });

 const res = await request(app)
 .post('/api/printers/heartbeat')
 .set('X-Agent-Token', 'token')
 .set('X-Branch-Id', 'br_001')
 .send({ printers: [{ name: 'HP-001', status: 'no_toner' }] });

 expect(res.status).toBe(200);
 expect(mockAlertEmit).toHaveBeenCalledTimes(1);
 expect(mockAlertEmit).toHaveBeenCalledWith({
 clientId: 'cl_001',
 branchId: 'br_001',
 printerId: 'prn_001',
 alertType: 'printer.no_toner',
 status: 'no_toner',
 });
 });

 test('printer low_toner → online (recovery từ thiếu mực): emit printer.online', async () => {
 mockGetPrinterByBranchAndName.mockResolvedValue({ id: 'prn_001', status: 'low_toner' });
 mockRunFn.mockResolvedValue({ rowCount: 1 });

 const res = await request(app)
 .post('/api/printers/heartbeat')
 .set('X-Agent-Token', 'token')
 .set('X-Branch-Id', 'br_001')
 .send({ printers: [{ name: 'HP-001', status: 'online' }] });

 expect(res.status).toBe(200);
 expect(mockAlertEmit).toHaveBeenCalledTimes(1);
 expect(mockAlertEmit).toHaveBeenCalledWith({
 clientId: 'cl_001',
 branchId: 'br_001',
 printerId: 'prn_001',
 alertType: 'printer.online',
 status: 'online',
 });
 });

 test('printer no_toner → online (recovery từ hết mực): emit printer.online', async () => {
 mockGetPrinterByBranchAndName.mockResolvedValue({ id: 'prn_002', status: 'no_toner' });
 mockRunFn.mockResolvedValue({ rowCount: 1 });

 const res = await request(app)
 .post('/api/printers/heartbeat')
 .set('X-Agent-Token', 'token')
 .set('X-Branch-Id', 'br_001')
 .send({ printers: [{ name: 'HP-002', status: 'online' }] });

 expect(res.status).toBe(200);
 expect(mockAlertEmit).toHaveBeenCalledWith(expect.objectContaining({
 alertType: 'printer.online',
 printerId: 'prn_002',
 }));
 });

 test('printer mới phát hiện (insertDiscoveredPrinter) → emit KHÔNG gọi', async () => {
 // Trường hợp printer chưa có trong DB (rowCount=0 → insertDiscoveredPrinter)
 mockGetPrinterByBranchAndName.mockResolvedValue(null);
 mockRunFn.mockResolvedValue({ rowCount: 0 });
 mockInsertDiscoveredPrinter.mockResolvedValue({ rowCount: 1 });

 const res = await request(app)
 .post('/api/printers/heartbeat')
 .set('X-Agent-Token', 'token')
 .set('X-Branch-Id', 'br_001')
 .send({ printers: [{ name: 'new-printer', status: 'online' }] });

 expect(res.status).toBe(200);
 expect(res.body).toEqual({ ok: true, updated: 0, discovered: 1 });
 expect(mockAlertEmit).not.toHaveBeenCalled();
 });
});

describe('Không scope tenant - thao tác mọi branch', () => {
 test('GET /api/printers?branch_id=X với branch của client khác → 200 (không scope)', async () => {
 const { stmts: mockStmts } = require('../../db');
 mockStmts.getBranchById.get.mockResolvedValueOnce({ id: 'br_x', client_id: 'cl_002' });
 mockListPrintersByBranch.mockResolvedValueOnce([]);

 const res = await request(app).get('/api/printers?branch_id=br_x');

 expect(res.status).toBe(200);
 expect(mockListPrintersByBranch).toHaveBeenCalled();
 });

 test('POST /api/printers với branch của client khác → 201, insertPrinter được gọi', async () => {
 const { stmts: mockStmts } = require('../../db');
 mockStmts.getBranchById.get.mockResolvedValueOnce({ id: 'br_x', client_id: 'cl_002' });
 mockListPrintersByBranch.mockResolvedValueOnce([]);
 mockStmts.insertPrinter.run.mockResolvedValueOnce({ rowCount: 1 });

 const res = await request(app)
 .post('/api/printers')
 .send({ branch_id: 'br_x', name: 'Printer X' });

 expect(res.status).toBe(201);
 expect(mockStmts.insertPrinter.run).toHaveBeenCalled();
 });

 test('PATCH /api/printers/:id với branch của client khác → 200, setPrinterApproved được gọi', async () => {
 const printer = { id: 'prn_x', branch_id: 'br_x', name: 'HP-X', is_default: 0, approved: 0 };
 const updated = { ...printer, approved: 1 };
 mockGetPrinterById.mockResolvedValueOnce(printer).mockResolvedValueOnce(updated);
 const { stmts: mockStmts } = require('../../db');
 mockStmts.getBranchById.get.mockResolvedValueOnce({ id: 'br_x', client_id: 'cl_002' });
 mockSetPrinterApproved.mockResolvedValueOnce({ rowCount: 1 });

 const res = await request(app)
 .patch('/api/printers/prn_x')
 .send({ approved: 1 });

 expect(res.status).toBe(200);
 expect(mockSetPrinterApproved).toHaveBeenCalled();
 });

 test('DELETE /api/printers/:id với branch của client khác → 200, deletePrinter được gọi', async () => {
 const printer = { id: 'prn_x', branch_id: 'br_x', name: 'HP-X' };
 mockGetPrinterById.mockResolvedValueOnce(printer);
 const { stmts: mockStmts } = require('../../db');
 mockStmts.getBranchById.get.mockResolvedValueOnce({ id: 'br_x', client_id: 'cl_002' });
 mockStmts.deletePrinter.run.mockResolvedValueOnce({ rowCount: 1 });

 const res = await request(app).delete('/api/printers/prn_x');

 expect(res.status).toBe(200);
 expect(mockStmts.deletePrinter.run).toHaveBeenCalled();
 });
});

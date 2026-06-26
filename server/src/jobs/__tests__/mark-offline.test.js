'use strict';

// mark-offline: cron hạ branches/printers stale về status='offline' (TASK 6 + TASK 7 wiring).
jest.mock('../../config', () => ({
  presence: { offlineMs: 120000, checkIntervalMs: 30000 },
}));
jest.mock('../../logger', () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../db', () => ({
  stmts: {
    markOfflineBranches: { all: jest.fn() },
    markOfflinePrinters: { all: jest.fn() },
    getBranchById: { get: jest.fn() },
  },
}));
jest.mock('../../services/alert-service', () => ({
  emit: jest.fn().mockResolvedValue(undefined),
}));

const { stmts } = require('../../db');
const logger = require('../../logger');
const alertService = require('../../services/alert-service');
const { run } = require('../mark-offline');

beforeEach(() => {
  jest.clearAllMocks();
  // Mặc định: không có row nào flip offline
  stmts.markOfflineBranches.all.mockResolvedValue([]);
  stmts.markOfflinePrinters.all.mockResolvedValue([]);
  stmts.getBranchById.get.mockResolvedValue(null);
});

describe('mark-offline run()', () => {
  test('gọi cả 2 stmt với cutoff = now - offlineMs', async () => {
    const before = Date.now() - 120000;
    await run();
    const after = Date.now() - 120000;

    expect(stmts.markOfflineBranches.all).toHaveBeenCalledTimes(1);
    expect(stmts.markOfflinePrinters.all).toHaveBeenCalledTimes(1);
    const brCutoff = stmts.markOfflineBranches.all.mock.calls[0][0].cutoff;
    const prCutoff = stmts.markOfflinePrinters.all.mock.calls[0][0].cutoff;
    expect(brCutoff).toBeGreaterThanOrEqual(before);
    expect(brCutoff).toBeLessThanOrEqual(after);
    expect(prCutoff).toBe(brCutoff);
  });

  test('có row đổi → log info; không có → không log', async () => {
    await run();
    expect(logger.info).not.toHaveBeenCalled();

    stmts.markOfflineBranches.all.mockResolvedValue([
      { id: 'br_1', client_id: 'cl_1' },
      { id: 'br_2', client_id: 'cl_2' },
    ]);
    await run();
    expect(logger.info).toHaveBeenCalledWith(
      'Marked stale stations offline',
      expect.objectContaining({ branches: 2, printers: 0 })
    );
  });

  test('stmt throw → nuốt lỗi (không reject), log error', async () => {
    stmts.markOfflineBranches.all.mockRejectedValue(new Error('db down'));
    await expect(run()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith('Mark-offline job error', { err: 'db down' });
  });
});

describe('mark-offline run() – alert wiring (TASK 7)', () => {
  test('không có row flip → alertService.emit KHÔNG được gọi', async () => {
    await run();
    expect(alertService.emit).not.toHaveBeenCalled();
  });

  test('branch flip offline → emit được gọi với alertType branch.offline', async () => {
    stmts.markOfflineBranches.all.mockResolvedValue([{ id: 'br_1', client_id: 'cl_1' }]);
    await run();
    expect(alertService.emit).toHaveBeenCalledWith({
      clientId: 'cl_1',
      branchId: 'br_1',
      alertType: 'branch.offline',
      status: 'offline',
    });
  });

  test('printer flip offline → emit alertType printer.offline, clientId lấy từ getBranchById', async () => {
    stmts.markOfflinePrinters.all.mockResolvedValue([{ id: 'prn_1', branch_id: 'br_1' }]);
    stmts.getBranchById.get.mockResolvedValue({ client_id: 'cl_1' });
    await run();
    expect(alertService.emit).toHaveBeenCalledWith({
      clientId: 'cl_1',
      branchId: 'br_1',
      printerId: 'prn_1',
      alertType: 'printer.offline',
      status: 'offline',
    });
  });

  test('getBranchById trả null (branch đã xóa) → emit với clientId null', async () => {
    stmts.markOfflinePrinters.all.mockResolvedValue([{ id: 'prn_2', branch_id: 'br_ghost' }]);
    stmts.getBranchById.get.mockResolvedValue(null);
    await run();
    expect(alertService.emit).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: null, printerId: 'prn_2', alertType: 'printer.offline' })
    );
  });
});

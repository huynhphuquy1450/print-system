'use strict';

// mark-offline: cron hạ branches/printers stale về status='offline' (TASK 6).
jest.mock('../../config', () => ({
  presence: { offlineMs: 120000, checkIntervalMs: 30000 },
}));
jest.mock('../../logger', () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../db', () => ({
  stmts: {
    markOfflineBranches: { run: jest.fn() },
    markOfflinePrinters: { run: jest.fn() },
  },
}));

const { stmts } = require('../../db');
const logger = require('../../logger');
const { run } = require('../mark-offline');

beforeEach(() => {
  jest.clearAllMocks();
  stmts.markOfflineBranches.run.mockResolvedValue({ rowCount: 0 });
  stmts.markOfflinePrinters.run.mockResolvedValue({ rowCount: 0 });
});

describe('mark-offline run()', () => {
  test('gọi cả 2 stmt với cutoff = now - offlineMs', async () => {
    const before = Date.now() - 120000;
    await run();
    const after = Date.now() - 120000;

    expect(stmts.markOfflineBranches.run).toHaveBeenCalledTimes(1);
    expect(stmts.markOfflinePrinters.run).toHaveBeenCalledTimes(1);
    const brCutoff = stmts.markOfflineBranches.run.mock.calls[0][0].cutoff;
    const prCutoff = stmts.markOfflinePrinters.run.mock.calls[0][0].cutoff;
    expect(brCutoff).toBeGreaterThanOrEqual(before);
    expect(brCutoff).toBeLessThanOrEqual(after);
    expect(prCutoff).toBe(brCutoff);
  });

  test('có row đổi → log info; không có → không log', async () => {
    await run();
    expect(logger.info).not.toHaveBeenCalled();

    stmts.markOfflineBranches.run.mockResolvedValue({ rowCount: 2 });
    await run();
    expect(logger.info).toHaveBeenCalledWith(
      'Marked stale stations offline',
      expect.objectContaining({ branches: 2, printers: 0 })
    );
  });

  test('stmt throw → nuốt lỗi (không reject), log error', async () => {
    stmts.markOfflineBranches.run.mockRejectedValue(new Error('db down'));
    await expect(run()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith('Mark-offline job error', { err: 'db down' });
  });
});

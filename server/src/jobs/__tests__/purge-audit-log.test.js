'use strict';

// HM5 retention — purge-audit-log cron. Có module-level lastRunDate → reset module
// giữa các test (giống cleanup-files.test.js). Gate giờ qua spy Date.getHours.

jest.mock('../../db', () => ({
  stmts: { deleteOldAuditLogs: { run: jest.fn() } },
}));

jest.mock('../../config', () => ({
  ...jest.requireActual('../../config'),
  audit: { retentionDays: 90 },
  cron: { ...jest.requireActual('../../config').cron, cleanupHour: 3 },
}));

const { stmts } = require('../../db');

function loadFresh() {
  jest.resetModules();
  jest.doMock('../../db', () => ({ stmts: { deleteOldAuditLogs: { run: stmts.deleteOldAuditLogs.run } } }));
  jest.doMock('../../config', () => ({
    ...jest.requireActual('../../config'),
    audit: { retentionDays: 90 },
    cron: { ...jest.requireActual('../../config').cron, cleanupHour: 3 },
  }));
  // eslint-disable-next-line global-require
  return require('../purge-audit-log');
}

beforeEach(() => {
  jest.clearAllMocks();
  stmts.deleteOldAuditLogs.run.mockResolvedValue({ rowCount: 5 });
});

afterEach(() => jest.restoreAllMocks());

describe('purge-audit-log run()', () => {
  test('đúng CLEANUP_HOUR → DELETE với cutoff = now - 90 ngày', async () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(3);
    const before = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const { run } = loadFresh();

    await run();

    expect(stmts.deleteOldAuditLogs.run).toHaveBeenCalledTimes(1);
    const cutoff = stmts.deleteOldAuditLogs.run.mock.calls[0][0].cutoff;
    expect(typeof cutoff).toBe('number');
    expect(cutoff).toBeGreaterThanOrEqual(before - 5000);
    expect(cutoff).toBeLessThanOrEqual(before + 5000);
  });

  test('sai giờ → không DELETE', async () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    const { run } = loadFresh();
    await run();
    expect(stmts.deleteOldAuditLogs.run).not.toHaveBeenCalled();
  });

  test('chạy 2 lần cùng ngày → chỉ DELETE 1 lần (lastRunDate gate)', async () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(3);
    const { run } = loadFresh();
    await run();
    await run();
    expect(stmts.deleteOldAuditLogs.run).toHaveBeenCalledTimes(1);
  });

  test('lỗi DB → nuốt, không ném', async () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(3);
    stmts.deleteOldAuditLogs.run.mockRejectedValue(new Error('db down'));
    const { run } = loadFresh();
    await expect(run()).resolves.toBeUndefined();
  });
});

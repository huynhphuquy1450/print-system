'use strict';

// Alerts retention — purge-alerts cron. Có module-level lastRunDate → reset module
// giữa các test (giống purge-audit-log.test.js). Gate giờ qua spy Date.getHours.

const mockLogger = { info: jest.fn(), error: jest.fn() };

jest.mock('../../db', () => ({
  stmts: { deleteAlertsOlderThan: { run: jest.fn() } },
}));

jest.mock('../../config', () => ({
  ...jest.requireActual('../../config'),
  alerts: { retentionDays: 90 },
  cron: { ...jest.requireActual('../../config').cron, cleanupHour: 3 },
}));

jest.mock('../../logger', () => mockLogger);

const { stmts } = require('../../db');

function loadFresh(overrides = {}) {
  jest.resetModules();
  const retentionDays = overrides.retentionDays !== undefined ? overrides.retentionDays : 90;
  jest.doMock('../../db', () => ({ stmts: { deleteAlertsOlderThan: { run: stmts.deleteAlertsOlderThan.run } } }));
  jest.doMock('../../config', () => ({
    ...jest.requireActual('../../config'),
    alerts: { retentionDays },
    cron: { ...jest.requireActual('../../config').cron, cleanupHour: 3 },
  }));
  jest.doMock('../../logger', () => mockLogger);
  // eslint-disable-next-line global-require
  return require('../purge-alerts');
}

beforeEach(() => {
  jest.clearAllMocks();
  stmts.deleteAlertsOlderThan.run.mockResolvedValue({ rowCount: 5 });
});

afterEach(() => jest.restoreAllMocks());

describe('purge-alerts run()', () => {
  test('đúng CLEANUP_HOUR → DELETE với cutoff = now - 90 ngày', async () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(3);
    const before = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const { run } = loadFresh();

    await run();

    expect(stmts.deleteAlertsOlderThan.run).toHaveBeenCalledTimes(1);
    const cutoff = stmts.deleteAlertsOlderThan.run.mock.calls[0][0].cutoff;
    expect(typeof cutoff).toBe('number');
    expect(cutoff).toBeGreaterThanOrEqual(before - 5000);
    expect(cutoff).toBeLessThanOrEqual(before + 5000);
  });

  test('sai giờ → không DELETE', async () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    const { run } = loadFresh();
    await run();
    expect(stmts.deleteAlertsOlderThan.run).not.toHaveBeenCalled();
  });

  test('chạy 2 lần cùng ngày → chỉ DELETE 1 lần (lastRunDate gate)', async () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(3);
    const { run } = loadFresh();
    await run();
    await run();
    expect(stmts.deleteAlertsOlderThan.run).toHaveBeenCalledTimes(1);
  });

  test('retentionDays <= 0 → không DELETE (cờ tắt)', async () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(3);
    const { run } = loadFresh({ retentionDays: 0 });
    await run();
    expect(stmts.deleteAlertsOlderThan.run).not.toHaveBeenCalled();
  });

  test('lỗi DB → nuốt, không ném', async () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(3);
    stmts.deleteAlertsOlderThan.run.mockRejectedValue(new Error('db down'));
    const { run } = loadFresh();
    await expect(run()).resolves.toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalledWith('Alerts purge error', expect.objectContaining({ err: 'db down' }));
  });
});

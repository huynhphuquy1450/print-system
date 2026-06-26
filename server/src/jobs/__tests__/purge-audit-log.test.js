'use strict';

// HM5 retention — purge-audit-log cron. Có module-level lastRunDate → reset module
// giữa các test (giống cleanup-files.test.js). Gate giờ qua spy Date.getHours.
//
// Code mới: purge-audit-log dùng db.transaction để archive trước rồi delete.
// Mock phải export db.transaction (identity wrapper) với tx.stmts chứa cả
// archiveOldAuditLogs và deleteOldAuditLogs. Expose các run fn ra stmts để assert.

jest.mock('../../db', () => {
  const archiveRun = jest.fn().mockResolvedValue({ rowCount: 0 });
  const deleteRun = jest.fn().mockResolvedValue({ rowCount: 1 });
  return {
    db: {
      transaction: (fn) => fn({
        stmts: {
          archiveOldAuditLogs: { run: archiveRun },
          deleteOldAuditLogs: { run: deleteRun },
        },
      }),
    },
    stmts: {
      archiveOldAuditLogs: { run: archiveRun },
      deleteOldAuditLogs: { run: deleteRun },
    },
  };
});

jest.mock('../../config', () => ({
  ...jest.requireActual('../../config'),
  audit: { retentionDays: 90 },
  cron: { ...jest.requireActual('../../config').cron, cleanupHour: 3 },
}));

const { stmts } = require('../../db');

function loadFresh(configOverrides) {
  jest.resetModules();
  const auditConfig = (configOverrides && configOverrides.audit)
    ? configOverrides.audit
    : { retentionDays: 90 };
  jest.doMock('../../db', () => ({
    db: {
      transaction: (fn) => fn({
        stmts: {
          archiveOldAuditLogs: { run: stmts.archiveOldAuditLogs.run },
          deleteOldAuditLogs: { run: stmts.deleteOldAuditLogs.run },
        },
      }),
    },
    stmts: {
      archiveOldAuditLogs: { run: stmts.archiveOldAuditLogs.run },
      deleteOldAuditLogs: { run: stmts.deleteOldAuditLogs.run },
    },
  }));
  jest.doMock('../../config', () => ({
    ...jest.requireActual('../../config'),
    audit: auditConfig,
    cron: { ...jest.requireActual('../../config').cron, cleanupHour: 3 },
  }));
  // eslint-disable-next-line global-require
  return require('../purge-audit-log');
}

beforeEach(() => {
  jest.clearAllMocks();
  stmts.archiveOldAuditLogs.run.mockResolvedValue({ rowCount: 0 });
  stmts.deleteOldAuditLogs.run.mockResolvedValue({ rowCount: 5 });
});

afterEach(() => jest.restoreAllMocks());

describe('purge-audit-log run()', () => {
  test('đúng CLEANUP_HOUR → archive + DELETE với cutoff = now - 90 ngày', async () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(3);
    const before = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const { run } = loadFresh();

    await run();

    // archiveOldAuditLogs phải được gọi trước deleteOldAuditLogs
    expect(stmts.archiveOldAuditLogs.run).toHaveBeenCalledTimes(1);
    const archiveArg = stmts.archiveOldAuditLogs.run.mock.calls[0][0];
    expect(typeof archiveArg.cutoff).toBe('number');
    expect(archiveArg.cutoff).toBeGreaterThanOrEqual(before - 5000);
    expect(archiveArg.cutoff).toBeLessThanOrEqual(before + 5000);
    expect(typeof archiveArg.archived_at).toBe('number');

    expect(stmts.deleteOldAuditLogs.run).toHaveBeenCalledTimes(1);
    const deleteArg = stmts.deleteOldAuditLogs.run.mock.calls[0][0];
    // Cả hai phải dùng cùng cutoff
    expect(deleteArg.cutoff).toBe(archiveArg.cutoff);
  });

  test('sai giờ → không archive, không DELETE', async () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    const { run } = loadFresh();
    await run();
    expect(stmts.archiveOldAuditLogs.run).not.toHaveBeenCalled();
    expect(stmts.deleteOldAuditLogs.run).not.toHaveBeenCalled();
  });

  test('chạy 2 lần cùng ngày → chỉ archive + DELETE 1 lần (lastRunDate gate)', async () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(3);
    const { run } = loadFresh();
    await run();
    await run();
    expect(stmts.archiveOldAuditLogs.run).toHaveBeenCalledTimes(1);
    expect(stmts.deleteOldAuditLogs.run).toHaveBeenCalledTimes(1);
  });

  test('cờ tắt: audit.retentionDays=0 → return ngay, không archive, không DELETE', async () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(3);
    const { run } = loadFresh({ audit: { retentionDays: 0 } });
    await run();
    expect(stmts.archiveOldAuditLogs.run).not.toHaveBeenCalled();
    expect(stmts.deleteOldAuditLogs.run).not.toHaveBeenCalled();
  });

  test('lỗi DB → nuốt, không ném', async () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(3);
    // Bất kỳ lỗi nào bên trong transaction (archive hoặc delete) đều bị nuốt
    stmts.archiveOldAuditLogs.run.mockRejectedValue(new Error('db down'));
    const { run } = loadFresh();
    await expect(run()).resolves.toBeUndefined();
  });
});

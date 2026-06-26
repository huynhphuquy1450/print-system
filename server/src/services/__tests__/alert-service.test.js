'use strict';

// TASK 7 — alert-service: ghi DB + bắn webhook. Mock db, webhook-service, logger.
jest.mock('../../db', () => ({
  stmts: {
    insertAlert: { run: jest.fn() },
  },
}));

jest.mock('../webhook-service', () => ({
  dispatchAlert: jest.fn().mockResolvedValue(),
}));

jest.mock('../../logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
}));

const { stmts } = require('../../db');
const webhookService = require('../webhook-service');
const alertService = require('../alert-service');

beforeEach(() => {
  jest.clearAllMocks();
  stmts.insertAlert.run.mockResolvedValue();
  webhookService.dispatchAlert.mockResolvedValue();
});

describe('emit', () => {
  test('gọi insertAlert.run với đúng cột và gọi dispatchAlert đúng tham số', async () => {
    await alertService.emit({
      clientId: 'cl_1',
      branchId: 'br_1',
      printerId: 'pr_1',
      alertType: 'printer_offline',
      status: 'offline',
    });

    expect(stmts.insertAlert.run).toHaveBeenCalledTimes(1);
    const insertArg = stmts.insertAlert.run.mock.calls[0][0];
    expect(insertArg).toMatchObject({
      client_id: 'cl_1',
      branch_id: 'br_1',
      printer_id: 'pr_1',
      alert_type: 'printer_offline',
      status: 'offline',
    });
    // created_at phải là số (timestamp ms)
    expect(typeof insertArg.created_at).toBe('number');

    expect(webhookService.dispatchAlert).toHaveBeenCalledWith({
      clientId: 'cl_1',
      alertType: 'printer_offline',
      branchId: 'br_1',
      printerId: 'pr_1',
      status: 'offline',
    });
  });

  test('clientId null → insertAlert.run vẫn được gọi với client_id null; dispatchAlert vẫn được gọi', async () => {
    await alertService.emit({
      clientId: null,
      branchId: 'br_2',
      printerId: null,
      alertType: 'branch_offline',
      status: 'offline',
    });

    expect(stmts.insertAlert.run).toHaveBeenCalledTimes(1);
    const insertArg = stmts.insertAlert.run.mock.calls[0][0];
    expect(insertArg.client_id).toBeNull();

    // dispatchAlert được gọi (nội bộ nó tự return sớm, nhưng emit không biết điều đó)
    expect(webhookService.dispatchAlert).toHaveBeenCalledTimes(1);
  });

  test('insertAlert.run reject → emit KHÔNG ném; dispatchAlert vẫn được gọi', async () => {
    stmts.insertAlert.run.mockRejectedValue(new Error('db lỗi'));

    await expect(
      alertService.emit({
        clientId: 'cl_1',
        branchId: 'br_1',
        printerId: null,
        alertType: 'branch_offline',
        status: 'offline',
      }),
    ).resolves.toBeUndefined();

    // lỗi DB được nuốt → dispatchAlert vẫn được gọi
    expect(webhookService.dispatchAlert).toHaveBeenCalledTimes(1);
  });
});

'use strict';

// audit-service.record() ghi qua stmts.insertAudit (mock '../../db').
jest.mock('../../db', () => ({
  stmts: {
    insertAudit: { run: jest.fn().mockResolvedValue({ rowCount: 1 }) },
  },
}));

const { stmts } = require('../../db');
const auditService = require('../audit-service');

beforeEach(() => {
  stmts.insertAudit.run.mockClear();
  stmts.insertAudit.run.mockResolvedValue({ rowCount: 1 });
});

describe('audit-service record()', () => {
  test('maps đầy đủ field vào row insert', async () => {
    await auditService.record({
      at: 1700000000000,
      actor_type: 'client',
      actor_id: 'cl_1',
      user_id: 'u_42',
      action: 'job.create',
      resource_type: 'job',
      resource_id: 'job_abc',
      method: 'POST',
      path: '/api/print-jobs',
      status_code: 201,
      ip: '10.0.0.1',
      user_agent: 'curl/8',
    });

    expect(stmts.insertAudit.run).toHaveBeenCalledTimes(1);
    expect(stmts.insertAudit.run.mock.calls[0][0]).toEqual({
      at: 1700000000000,
      actor_type: 'client',
      actor_id: 'cl_1',
      user_id: 'u_42',
      action: 'job.create',
      resource_type: 'job',
      resource_id: 'job_abc',
      method: 'POST',
      path: '/api/print-jobs',
      status_code: 201,
      ip: '10.0.0.1',
      user_agent: 'curl/8',
    });
  });

  test('default at = Date.now(); field thiếu → null', async () => {
    const before = Date.now();
    await auditService.record({ action: 'auth.login' });
    const after = Date.now();

    const row = stmts.insertAudit.run.mock.calls[0][0];
    expect(row.at).toBeGreaterThanOrEqual(before);
    expect(row.at).toBeLessThanOrEqual(after);
    expect(row.actor_id).toBeNull();
    expect(row.user_id).toBeNull();
    expect(row.resource_id).toBeNull();
    expect(row.status_code).toBeNull();
  });

  test('status_code = 0 được giữ (không coerce thành null)', async () => {
    await auditService.record({ action: 'x', status_code: 0 });
    expect(stmts.insertAudit.run.mock.calls[0][0].status_code).toBe(0);
  });

  test('lỗi DB được nuốt — không ném ra ngoài', async () => {
    stmts.insertAudit.run.mockRejectedValueOnce(new Error('db down'));
    await expect(auditService.record({ action: 'job.create' })).resolves.toBeUndefined();
  });
});

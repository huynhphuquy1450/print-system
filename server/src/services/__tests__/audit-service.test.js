'use strict';

// audit-service.record() ghi qua stmts.insertAudit (mock '../../db').
jest.mock('../../db', () => ({
  db: { query: jest.fn() },
  stmts: {
    insertAudit: { run: jest.fn().mockResolvedValue({ rowCount: 1 }) },
  },
}));

const { db, stmts } = require('../../db');
const auditService = require('../audit-service');

beforeEach(() => {
  jest.clearAllMocks();
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

describe('audit-service list()', () => {
  test('thiếu clientId → ném (không cho đọc audit toàn cục)', async () => {
    await expect(auditService.list({})).rejects.toThrow(/clientId/);
  });

  test('luôn scope theo client + branch thuộc client (tenant isolation)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total: '2' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, action: 'auth.login' }] });

    const out = await auditService.list({ clientId: 'cl_1' });
    expect(out.total).toBe(2);
    expect(out.entries).toHaveLength(1);
    // WHERE giới hạn actor_id = client HOẶC branch thuộc client; chỉ 1 param $1
    expect(db.query.mock.calls[0][0]).toMatch(
      /WHERE \(actor_id = \$1 OR actor_id IN \(SELECT id FROM branches WHERE client_id = \$1\)\)/
    );
    expect(db.query.mock.calls[0][1]).toEqual(['cl_1']);
  });

  test('filter actor_id + action → nối sau scope, params đúng thứ tự, kèm limit/offset', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [] });

    await auditService.list({ clientId: 'cl_1', actorId: 'cl_1', action: 'job.create', limit: 20, offset: 40 });
    expect(db.query.mock.calls[0][0]).toMatch(/\) AND actor_id = \$2 AND action = \$3/);
    expect(db.query.mock.calls[0][1]).toEqual(['cl_1', 'cl_1', 'job.create']);
    expect(db.query.mock.calls[1][1]).toEqual(['cl_1', 'cl_1', 'job.create', 20, 40]);
  });
});

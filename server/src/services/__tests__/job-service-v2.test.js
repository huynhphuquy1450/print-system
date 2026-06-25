'use strict';

// HM3 — listJobsFiltered + retryJob. Mock riêng (cần db.query + stmts.requeueJob),
// tách khỏi job-service.test.js để giữ surgical.
jest.mock('../../db', () => ({
  db: { query: jest.fn() },
  stmts: {
    getJobById: { get: jest.fn() },
    requeueJob: { run: jest.fn() },
  },
}));

jest.mock('../../mqtt-client', () => ({ publishJob: jest.fn(), isConnected: jest.fn() }));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
}));

const fs = require('fs');
const mqttClient = require('../../mqtt-client');
const { db, stmts } = require('../../db');
const { listJobsFiltered, retryJob } = require('../job-service');

beforeEach(() => {
  jest.clearAllMocks();
  mqttClient.publishJob.mockResolvedValue(true);
  fs.existsSync.mockReturnValue(true);
  stmts.requeueJob.run.mockResolvedValue({ rowCount: 1 });
});

describe('listJobsFiltered (HM3)', () => {
  test('luôn scope theo clientId (WHERE client_id = $1)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total: '3' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'j1', metadata: '{"user_id":"u1"}' }] });

    const out = await listJobsFiltered({ clientId: 'client_001' });
    expect(out.total).toBe(3);
    expect(out.limit).toBe(50);
    expect(out.offset).toBe(0);
    expect(out.jobs[0].metadata).toEqual({ user_id: 'u1' }); // metadata parsed
    // COUNT query luôn lọc theo client_id (tenant isolation)
    expect(db.query.mock.calls[0][0]).toMatch(/WHERE client_id = \$1/);
    expect(db.query.mock.calls[0][1]).toEqual(['client_001']);
  });

  test('thiếu clientId → ném 400 (không cho query toàn cục)', async () => {
    await expect(listJobsFiltered({})).rejects.toMatchObject({ status: 400 });
  });

  test('filter branch_id + status → client_id đứng trước, params đúng thứ tự', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [] });

    await listJobsFiltered({ clientId: 'client_001', branchId: 'br_1', status: 'failed', limit: 10, offset: 5 });
    const [countSql, countParams] = db.query.mock.calls[0];
    expect(countSql).toMatch(/WHERE client_id = \$1 AND branch_id = \$2 AND status = \$3/);
    expect(countParams).toEqual(['client_001', 'br_1', 'failed']);
    // page query thêm limit+offset vào cuối params
    const [, pageParams] = db.query.mock.calls[1];
    expect(pageParams).toEqual(['client_001', 'br_1', 'failed', 10, 5]);
  });

  test('limit bị kẹp trong [1,200]', async () => {
    db.query.mockResolvedValue({ rows: [{ total: '0' }] });
    const out = await listJobsFiltered({ clientId: 'client_001', limit: 9999 });
    expect(out.limit).toBe(200);
  });
});

describe('retryJob (HM3)', () => {
  test('job không tồn tại → 404', async () => {
    stmts.getJobById.get.mockResolvedValue(null);
    await expect(retryJob('jX', 'client_001')).rejects.toMatchObject({ status: 404 });
  });

  test('job của client khác → 404 (tenant isolation, không lộ tồn tại)', async () => {
    stmts.getJobById.get.mockResolvedValue({ id: 'jX', status: 'failed', file_path: '/x.pdf', client_id: 'client_OTHER' });
    await expect(retryJob('jX', 'client_001')).rejects.toMatchObject({ status: 404 });
    expect(mqttClient.publishJob).not.toHaveBeenCalled();
  });

  test("status 'printed' → 409 (chỉ retry failed)", async () => {
    stmts.getJobById.get.mockResolvedValue({ id: 'jX', status: 'printed', file_path: '/x.pdf', client_id: 'client_001' });
    await expect(retryJob('jX', 'client_001')).rejects.toMatchObject({ status: 409 });
  });

  test("status 'sent' → 409 (KHÔNG retry job đang in, tránh in trùng)", async () => {
    stmts.getJobById.get.mockResolvedValue({ id: 'jX', status: 'sent', file_path: '/x.pdf', client_id: 'client_001' });
    await expect(retryJob('jX', 'client_001')).rejects.toMatchObject({ status: 409 });
    expect(mqttClient.publishJob).not.toHaveBeenCalled();
  });

  test('file đã bị cleanup → 410', async () => {
    stmts.getJobById.get.mockResolvedValue({ id: 'jX', status: 'failed', file_path: '/x.pdf', branch_id: 'br_1', client_id: 'client_001' });
    fs.existsSync.mockReturnValue(false);
    await expect(retryJob('jX', 'client_001')).rejects.toMatchObject({ status: 410 });
  });

  test('happy: failed + file còn + đúng chủ → publish + requeue, trả status sent', async () => {
    stmts.getJobById.get.mockResolvedValue({
      id: 'jX', status: 'failed', file_path: '/x.pdf', branch_id: 'br_1',
      printer: 'P1', metadata: '{"user_id":"u9"}', client_id: 'client_001',
    });
    const out = await retryJob('jX', 'client_001');
    expect(mqttClient.publishJob).toHaveBeenCalledWith('br_1', expect.objectContaining({
      job_id: 'jX', version: 2, printer: 'P1', metadata: { user_id: 'u9' },
    }));
    expect(stmts.requeueJob.run).toHaveBeenCalledWith(expect.objectContaining({ id: 'jX' }));
    expect(out).toMatchObject({ ok: true, job_id: 'jX', status: 'sent' });
  });
});

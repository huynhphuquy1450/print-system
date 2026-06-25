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
  test('không filter → query không WHERE, trả total + page', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total: '3' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'j1', metadata: '{"user_id":"u1"}' }] });

    const out = await listJobsFiltered({});
    expect(out.total).toBe(3);
    expect(out.limit).toBe(50);
    expect(out.offset).toBe(0);
    expect(out.jobs[0].metadata).toEqual({ user_id: 'u1' }); // metadata parsed
    // COUNT query không có WHERE
    expect(db.query.mock.calls[0][0]).not.toMatch(/WHERE/);
  });

  test('filter branch_id + status → WHERE có 2 điều kiện, params đúng thứ tự', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [] });

    await listJobsFiltered({ branchId: 'br_1', status: 'failed', limit: 10, offset: 5 });
    const [countSql, countParams] = db.query.mock.calls[0];
    expect(countSql).toMatch(/WHERE branch_id = \$1 AND status = \$2/);
    expect(countParams).toEqual(['br_1', 'failed']);
    // page query thêm limit+offset vào cuối params
    const [, pageParams] = db.query.mock.calls[1];
    expect(pageParams).toEqual(['br_1', 'failed', 10, 5]);
  });

  test('limit bị kẹp trong [1,200]', async () => {
    db.query.mockResolvedValue({ rows: [{ total: '0' }] });
    const out = await listJobsFiltered({ limit: 9999 });
    expect(out.limit).toBe(200);
  });
});

describe('retryJob (HM3)', () => {
  test('job không tồn tại → 404', async () => {
    stmts.getJobById.get.mockResolvedValue(null);
    await expect(retryJob('jX')).rejects.toMatchObject({ status: 404 });
  });

  test("status 'printed' → 409 (chỉ retry failed/sent)", async () => {
    stmts.getJobById.get.mockResolvedValue({ id: 'jX', status: 'printed', file_path: '/x.pdf' });
    await expect(retryJob('jX')).rejects.toMatchObject({ status: 409 });
  });

  test('file đã bị cleanup → 410', async () => {
    stmts.getJobById.get.mockResolvedValue({ id: 'jX', status: 'failed', file_path: '/x.pdf', branch_id: 'br_1' });
    fs.existsSync.mockReturnValue(false);
    await expect(retryJob('jX')).rejects.toMatchObject({ status: 410 });
  });

  test('happy: failed + file còn → publish + requeue, trả status sent', async () => {
    stmts.getJobById.get.mockResolvedValue({
      id: 'jX', status: 'failed', file_path: '/x.pdf', branch_id: 'br_1',
      printer: 'P1', metadata: '{"user_id":"u9"}',
    });
    const out = await retryJob('jX');
    expect(mqttClient.publishJob).toHaveBeenCalledWith('br_1', expect.objectContaining({
      job_id: 'jX', version: 2, printer: 'P1', metadata: { user_id: 'u9' },
    }));
    expect(stmts.requeueJob.run).toHaveBeenCalledWith(expect.objectContaining({ id: 'jX' }));
    expect(out).toMatchObject({ ok: true, job_id: 'jX', status: 'sent' });
  });
});

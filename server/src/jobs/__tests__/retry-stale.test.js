'use strict';

// retry-stale: sau khi republish job stale ('sent'), phải dùng requeueJob (cập nhật sent_at +
// retry_count) THAY VÌ markJobSent (có guard status='pending' → no-op với job 'sent' → kẹt).
jest.mock('../../config', () => ({
  cron: { staleJobMin: 5, maxRetries: 5, retryIntervalMin: 5 },
}));
jest.mock('../../logger', () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../db', () => ({
  stmts: {
    findStaleJobs: { all: jest.fn() },
    requeueJob: { run: jest.fn() },
    incrementRetry: { run: jest.fn() },
    markJobSent: { run: jest.fn() },
    markJobFailed: { run: jest.fn() },
  },
}));
jest.mock('../../mqtt-client', () => ({ isConnected: jest.fn(), publishJob: jest.fn() }));
jest.mock('../../services/webhook-service', () => ({ dispatch: jest.fn().mockResolvedValue(undefined) }));
jest.mock('fs', () => ({ ...jest.requireActual('fs'), readFileSync: jest.fn() }));

const fs = require('fs');
const { stmts } = require('../../db');
const mqttClient = require('../../mqtt-client');
const { run } = require('../retry-stale');

beforeEach(() => {
  jest.clearAllMocks();
  mqttClient.isConnected.mockReturnValue(true);
  fs.readFileSync.mockReturnValue(Buffer.from('%PDF-1.4 fake'));
  mqttClient.publishJob.mockResolvedValue(true);
  stmts.requeueJob.run.mockResolvedValue({ rowCount: 1 });
});

describe('retry-stale run()', () => {
  test('republish OK → requeueJob (set sent_at), KHÔNG markJobSent/incrementRetry', async () => {
    stmts.findStaleJobs.all.mockResolvedValue([
      { id: 'j1', branch_id: 'br_1', file_path: '/x.pdf', printer: 'P', metadata: '{}', retry_count: 1, client_id: 'c1' },
    ]);

    await run();

    expect(mqttClient.publishJob).toHaveBeenCalledTimes(1);
    expect(stmts.requeueJob.run).toHaveBeenCalledWith(expect.objectContaining({ id: 'j1' }));
    expect(stmts.requeueJob.run.mock.calls[0][0]).toHaveProperty('sent_at');
    // markJobSent (guard 'pending', no-op với job 'sent') không còn được dùng ở success path
    expect(stmts.markJobSent.run).not.toHaveBeenCalled();
    expect(stmts.incrementRetry.run).not.toHaveBeenCalled();
  });

  test('publish lỗi → incrementRetry; đạt max → markJobFailed', async () => {
    mqttClient.publishJob.mockRejectedValue(new Error('mqtt down'));
    stmts.findStaleJobs.all.mockResolvedValue([
      { id: 'j2', branch_id: 'br_1', file_path: '/x.pdf', printer: 'P', metadata: '{}', retry_count: 4, client_id: 'c1' },
    ]);

    await run();

    expect(stmts.incrementRetry.run).toHaveBeenCalledWith({ id: 'j2' });
    expect(stmts.markJobFailed.run).toHaveBeenCalledTimes(1); // 4+1 >= maxRetries(5)
    expect(stmts.requeueJob.run).not.toHaveBeenCalled();
  });
});

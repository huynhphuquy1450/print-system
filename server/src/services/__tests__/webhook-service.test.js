'use strict';

// HM4 — webhook-service: sign/eventsMatch/deliver/dispatch. Mock db + global fetch.
jest.mock('../../db', () => ({
  stmts: {
    listActiveWebhooksByClient: { all: jest.fn() },
  },
}));

const crypto = require('crypto');
const { stmts } = require('../../db');
const webhookService = require('../webhook-service');

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

describe('sign / eventsMatch', () => {
  test('sign = HMAC-SHA256 hex deterministic', () => {
    const body = '{"a":1}';
    const expected = crypto.createHmac('sha256', 's3cret').update(body).digest('hex');
    expect(webhookService.sign('s3cret', body)).toBe(expected);
  });

  test('eventsMatch xét CSV có trim', () => {
    expect(webhookService.eventsMatch('job.status, other', 'job.status')).toBe(true);
    expect(webhookService.eventsMatch('other', 'job.status')).toBe(false);
    expect(webhookService.eventsMatch('', 'job.status')).toBe(false);
  });
});

describe('deliver', () => {
  test('fetch ok → true, gửi đúng header X-Signature', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 });
    const hook = { id: 'wh_1', url: 'https://erp.example/cb', secret: 'sec' };
    const payload = { event: 'job.status', delivery_id: 'd1', job_id: 'jX', status: 'printed' };

    const ok = await webhookService.deliver(hook, payload);
    expect(ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://erp.example/cb');
    const expectedSig = 'sha256=' + webhookService.sign('sec', opts.body);
    expect(opts.headers['X-Signature']).toBe(expectedSig);
    expect(opts.headers['X-Delivery-Id']).toBe('d1');
  });

  test('fetch luôn non-2xx → false sau MAX_ATTEMPTS lần thử', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500 });
    const ok = await webhookService.deliver({ id: 'wh', url: 'https://x/y', secret: 's' }, { event: 'job.status' });
    expect(ok).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});

describe('dispatch', () => {
  test('không có clientId → không gọi DB/fetch', async () => {
    await webhookService.dispatch({ jobId: 'jX', status: 'printed' });
    expect(stmts.listActiveWebhooksByClient.all).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('chỉ gửi tới hook có event khớp', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 });
    stmts.listActiveWebhooksByClient.all.mockResolvedValue([
      { id: 'wh_1', url: 'https://a/cb', secret: 's1', events: 'job.status' },
      { id: 'wh_2', url: 'https://b/cb', secret: 's2', events: 'other.event' },
    ]);

    await webhookService.dispatch({ clientId: 'cl_1', jobId: 'jX', status: 'printed', branchId: 'br_1' });
    // dispatch fire-and-forget — chờ microtask để deliver gọi fetch
    await new Promise((r) => setImmediate(r));

    expect(stmts.listActiveWebhooksByClient.all).toHaveBeenCalledWith({ client_id: 'cl_1' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('https://a/cb');
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ event: 'job.status', job_id: 'jX', status: 'printed', branch_id: 'br_1' });
  });

  test('lỗi DB khi list → nuốt, không ném', async () => {
    stmts.listActiveWebhooksByClient.all.mockRejectedValue(new Error('db down'));
    await expect(webhookService.dispatch({ clientId: 'cl_1', jobId: 'jX', status: 'printed' })).resolves.toBeUndefined();
  });
});

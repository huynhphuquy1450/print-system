'use strict';

// HM4 — webhook-service: sign/eventsMatch/deliver/dispatch + SSRF guard. Mock db + dns + fetch.
jest.mock('../../db', () => ({
  stmts: {
    listActiveWebhooksByClient: { all: jest.fn() },
  },
}));

// dns.promises.lookup được mock để deliver/assertPublicUrl không gọi DNS thật.
jest.mock('dns', () => ({ promises: { lookup: jest.fn() } }));

const crypto = require('crypto');
const dns = require('dns');
const { stmts } = require('../../db');
const config = require('../../config');
const webhookService = require('../webhook-service');

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
  // Mặc định: host trỏ tới IP public → SSRF guard cho qua.
  dns.promises.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
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

  test('fetch luôn 5xx → false sau MAX_ATTEMPTS lần thử (có retry)', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500 });
    const ok = await webhookService.deliver({ id: 'wh', url: 'https://x/y', secret: 's' }, { event: 'job.status' });
    expect(ok).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test('fetch 4xx → false NGAY, KHÔNG retry (lỗi client vĩnh viễn)', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 404 });
    const ok = await webhookService.deliver({ id: 'wh', url: 'https://erp.example/cb', secret: 's' }, { event: 'job.status' });
    expect(ok).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
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

describe('dispatchAlert', () => {
  test('không có clientId → return sớm, không query DB / fetch', async () => {
    await webhookService.dispatchAlert({ alertType: 'branch_offline', branchId: 'br_1', status: 'offline' });
    expect(stmts.listActiveWebhooksByClient.all).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('hook có event "alert" → fetch đúng URL; body có event/alert_type/printer_id/branch_id/status; không có job_id', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 });
    stmts.listActiveWebhooksByClient.all.mockResolvedValue([
      { id: 'wh_a', url: 'https://erp.example/alert', secret: 'sec', events: 'alert' },
      { id: 'wh_b', url: 'https://erp.example/job', secret: 'sec', events: 'job.status' },
    ]);

    await webhookService.dispatchAlert({
      clientId: 'cl_1',
      alertType: 'printer_offline',
      branchId: 'br_1',
      printerId: 'pr_1',
      status: 'offline',
    });
    // fire-and-forget — chờ microtask để deliver gọi fetch
    await new Promise((r) => setImmediate(r));

    expect(stmts.listActiveWebhooksByClient.all).toHaveBeenCalledWith({ client_id: 'cl_1' });
    // chỉ hook có event 'alert' được gửi
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('https://erp.example/alert');

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      event: 'alert',
      alert_type: 'printer_offline',
      printer_id: 'pr_1',
      branch_id: 'br_1',
      status: 'offline',
    });
    expect(body).not.toHaveProperty('job_id');
  });

  test('hook có events "job.status,alert" (CSV) → fetch được gọi', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 });
    stmts.listActiveWebhooksByClient.all.mockResolvedValue([
      { id: 'wh_c', url: 'https://erp.example/multi', secret: 'sec', events: 'job.status,alert' },
    ]);

    await webhookService.dispatchAlert({
      clientId: 'cl_2',
      alertType: 'branch_offline',
      branchId: 'br_2',
      status: 'offline',
    });
    await new Promise((r) => setImmediate(r));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.event).toBe('alert');
  });

  test('hook chỉ có events "job.status" → KHÔNG gọi fetch', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 });
    stmts.listActiveWebhooksByClient.all.mockResolvedValue([
      { id: 'wh_d', url: 'https://erp.example/cb', secret: 'sec', events: 'job.status' },
    ]);

    await webhookService.dispatchAlert({ clientId: 'cl_3', alertType: 'branch_offline', branchId: 'br_3', status: 'offline' });
    await new Promise((r) => setImmediate(r));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('lỗi DB khi list → nuốt, không ném', async () => {
    stmts.listActiveWebhooksByClient.all.mockRejectedValue(new Error('db down'));
    await expect(
      webhookService.dispatchAlert({ clientId: 'cl_1', alertType: 'branch_offline', branchId: 'br_1', status: 'offline' }),
    ).resolves.toBeUndefined();
  });
});

describe('SSRF guard', () => {
  test('isPrivateIp: nhận diện loopback/private/link-local/ULA', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', 'fe80::1']) {
      expect(webhookService.isPrivateIp(ip)).toBe(true);
    }
    for (const ip of ['8.8.8.8', '93.184.216.34', '2606:2800:220:1::1']) {
      expect(webhookService.isPrivateIp(ip)).toBe(false);
    }
  });

  test('validateWebhookUrl: chặn scheme lạ + host nội bộ literal/localhost', () => {
    expect(webhookService.validateWebhookUrl('https://erp.example/cb').ok).toBe(true);
    expect(webhookService.validateWebhookUrl('ftp://x/y').ok).toBe(false);
    expect(webhookService.validateWebhookUrl('not a url').ok).toBe(false);
    expect(webhookService.validateWebhookUrl('http://localhost/cb').ok).toBe(false);
    expect(webhookService.validateWebhookUrl('http://127.0.0.1/cb').ok).toBe(false);
    expect(webhookService.validateWebhookUrl('http://169.254.169.254/latest/meta-data').ok).toBe(false);
    expect(webhookService.validateWebhookUrl('http://192.168.0.5:8080/cb').ok).toBe(false);
  });

  test('allowlist (opt-in): chỉ host khớp exact/subdomain mới qua', () => {
    config.webhook.allowedHosts = ['erp.acme.com'];
    try {
      expect(webhookService.validateWebhookUrl('https://erp.acme.com/cb').ok).toBe(true);
      expect(webhookService.validateWebhookUrl('https://api.erp.acme.com/cb').ok).toBe(true); // subdomain
      expect(webhookService.validateWebhookUrl('https://evil.com/cb').ok).toBe(false);
      expect(webhookService.validateWebhookUrl('https://notacme.com/cb').ok).toBe(false);
    } finally {
      config.webhook.allowedHosts = []; // reset để không ảnh hưởng test khác
    }
  });

  test('assertPublicUrl: ném khi DNS trỏ tới IP nội bộ (chống DNS rebinding)', async () => {
    dns.promises.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    await expect(webhookService.assertPublicUrl('https://rebind.evil/cb')).rejects.toThrow(/nội bộ/);
  });

  test('deliver: URL bị chặn → trả false, KHÔNG fetch', async () => {
    dns.promises.lookup.mockResolvedValue([{ address: '10.0.0.9', family: 4 }]);
    const ok = await webhookService.deliver({ id: 'wh', url: 'https://rebind.evil/cb', secret: 's' }, { event: 'job.status' });
    expect(ok).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

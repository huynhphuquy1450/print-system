'use strict';

// Mock config to control max value (3 instead of 30 for fast tests)
jest.mock('../../config', () => ({
  ...jest.requireActual('../../config'),
  rateLimit: { clientWritePerMin: 3 },
}));

const { clientRateLimit, bulkRateLimit } = require('../rate-limit-client');

// express-rate-limit v7 trả về AsyncFunction, cần res có setHeader/send để tránh crash.
// Trong production, res là express Response thật — không thiếu.
function mockReqRes(clientId) {
  const req = {
    client: clientId ? { id: clientId, name: 'Test Client' } : undefined,
    ip: '1.2.3.4',
    headers: {},
    app: { get: () => undefined },
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
    getHeader: jest.fn(),
    headersSent: false,
    on: jest.fn(),
    once: jest.fn(),
    emit: jest.fn(),
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('clientRateLimit middleware', () => {
  test('1st request → calls next(), does not 429', async () => {
    const mw = clientRateLimit();
    const { req, res, next } = mockReqRes('client_001');

    await mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('max+1 requests with same client.id → last returns 429', async () => {
    const mw = clientRateLimit();
    // max=3 → first 3 requests pass
    for (let i = 0; i < 3; i++) {
      const { req, res, next } = mockReqRes('client_001');
      await mw(req, res, next);
    }
    // 4th request should be blocked
    const { req, res, next } = mockReqRes('client_001');
    await mw(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.send).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('different clients have isolated counters', async () => {
    const mw = clientRateLimit();
    // client_001 exhausts its limit
    for (let i = 0; i < 3; i++) {
      const { req, res, next } = mockReqRes('client_001');
      await mw(req, res, next);
    }
    // client_002 should still pass (independent counter)
    const { req, res, next } = mockReqRes('client_002');
    await mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('req.client undefined → calls next(error) (defensive contract)', async () => {
    const mw = clientRateLimit();
    const { req, res, next } = mockReqRes(null);

    // express-rate-limit v7 handleAsyncErrors catches keyGenerator throw
    // and forwards via next(err) — không phải reject promise.
    await mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/verifyClient/);
  });
});

describe('bulkRateLimit middleware (đếm theo số job, không theo request)', () => {
  // max = clientWritePerMin = 3 (config mock).
  function reqWithFiles(clientId, n) {
    const { req, res, next } = mockReqRes(clientId);
    req.files = Array.from({ length: n }, (_, i) => ({ originalname: `f${i}.pdf` }));
    return { req, res, next };
  }

  test('tổng số file vượt max → 429 (1 request 2 file + 1 request 2 file = 4 > 3)', () => {
    const mw = bulkRateLimit();
    const a = reqWithFiles('bulk_c1', 2);
    mw(a.req, a.res, a.next);
    expect(a.next).toHaveBeenCalledTimes(1); // 2 ≤ 3 → qua

    const b = reqWithFiles('bulk_c1', 2);
    mw(b.req, b.res, b.next);
    expect(b.res.status).toHaveBeenCalledWith(429); // 2+2=4 > 3 → chặn
    expect(b.next).not.toHaveBeenCalled();
  });

  test('client khác nhau có bộ đếm độc lập', () => {
    const mw = bulkRateLimit();
    const a = reqWithFiles('bulk_c2', 3);
    mw(a.req, a.res, a.next); // dùng hết quota c2
    const b = reqWithFiles('bulk_c3', 3);
    mw(b.req, b.res, b.next);
    expect(b.next).toHaveBeenCalledTimes(1);
    expect(b.res.status).not.toHaveBeenCalled();
  });

  test('req.client undefined → next(error)', () => {
    const mw = bulkRateLimit();
    const { req, res, next } = reqWithFiles(null, 1);
    mw(req, res, next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(next.mock.calls[0][0].message).toMatch(/verifyClient/);
  });
});
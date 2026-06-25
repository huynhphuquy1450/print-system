'use strict';

// Middleware audit-log: hook res.on('finish'). Mock audit-service để bắt entry ghi.
jest.mock('../../services/audit-service', () => ({ record: jest.fn() }));

const { EventEmitter } = require('events');
const auditService = require('../../services/audit-service');
const { auditLog } = require('../audit-log');

function makeReqRes({ method = 'GET', path = '/x', client, agent, locals = {}, statusCode = 200 } = {}) {
  const req = { method, path, ip: '1.2.3.4', headers: { 'user-agent': 'jest' }, client, agent };
  const res = new EventEmitter();
  res.locals = locals;
  res.statusCode = statusCode;
  return { req, res };
}

beforeEach(() => auditService.record.mockClear());

describe('auditLog middleware', () => {
  test('gọi next() ngay (không chặn request)', () => {
    const { req, res } = makeReqRes();
    const next = jest.fn();
    auditLog(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('GET không có res.locals.audit → KHÔNG ghi', () => {
    const { req, res } = makeReqRes({ method: 'GET' });
    auditLog(req, res, jest.fn());
    res.emit('finish');
    expect(auditService.record).not.toHaveBeenCalled();
  });

  test('GET nhạy cảm (có res.locals.audit) → CÓ ghi với action của handler', () => {
    const { req, res } = makeReqRes({
      method: 'GET',
      path: '/api/print-jobs/job_1/file',
      agent: { branchId: 'br_001' },
      locals: { audit: { action: 'job.file_download', resource_type: 'job', resource_id: 'job_1' } },
    });
    auditLog(req, res, jest.fn());
    res.emit('finish');

    expect(auditService.record).toHaveBeenCalledTimes(1);
    const e = auditService.record.mock.calls[0][0];
    expect(e.action).toBe('job.file_download');
    expect(e.actor_type).toBe('agent');
    expect(e.actor_id).toBe('br_001');
    expect(e.resource_id).toBe('job_1');
    expect(e.ip).toBe('1.2.3.4');
    expect(e.user_agent).toBe('jest');
  });

  test('POST (write) không có audit → ghi với action fallback method+path', () => {
    const { req, res } = makeReqRes({ method: 'POST', path: '/api/printers', client: { id: 'cl_9' }, statusCode: 201 });
    auditLog(req, res, jest.fn());
    res.emit('finish');

    const e = auditService.record.mock.calls[0][0];
    expect(e.action).toBe('POST /api/printers');
    expect(e.actor_type).toBe('client');
    expect(e.actor_id).toBe('cl_9');
    expect(e.status_code).toBe(201);
  });

  test('POST có res.locals.audit (job.create) → ghi action + user_id của handler', () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      path: '/api/print-jobs',
      client: { id: 'cl_1' },
      statusCode: 201,
      locals: { audit: { action: 'job.create', resource_type: 'job', resource_id: 'job_x', user_id: 'u_7' } },
    });
    auditLog(req, res, jest.fn());
    res.emit('finish');

    const e = auditService.record.mock.calls[0][0];
    expect(e.action).toBe('job.create');
    expect(e.user_id).toBe('u_7');
    expect(e.resource_id).toBe('job_x');
  });

  test('không có auth → actor_type anonymous', () => {
    const { req, res } = makeReqRes({ method: 'DELETE', path: '/api/printers/p1' });
    auditLog(req, res, jest.fn());
    res.emit('finish');
    expect(auditService.record.mock.calls[0][0].actor_type).toBe('anonymous');
  });
});

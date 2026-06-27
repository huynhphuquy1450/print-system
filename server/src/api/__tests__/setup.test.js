'use strict';

// Tests for POST /api/setup/register-branch (Task 7 §10.1 #5).
// Rate-limit test is in setup.rate-limit.test.js (separate file because
// jest.isolateModules is needed to get a fresh limiter per test file).

jest.mock('../../db', () => ({
 stmts: {
 insertBranch: { run: jest.fn() },
 getBranchByClientAndName: { get: jest.fn() },
 },
}));

jest.mock('../../services/auth-service', () => ({
 verifyClientCredentials: jest.fn(),
}));

jest.mock('../../config', () => ({
 ...jest.requireActual('../../config'),
 env: 'test',
 rateLimit: {
 ...jest.requireActual('../../config').rateLimit,
 // Use a very high max so unit tests in this file don't trip the rate
 // limit. The dedicated rate-limit test uses jest.isolateModules to
 // instantiate a fresh limiter with max=3.
 setupRegisterPerHour: 1000,
 },
 mqtt: { ...jest.requireActual('../../config').mqtt, topicPrefix: 'company/printer' },
}));

const express = require('express');
const request = require('supertest');
const { stmts } = require('../../db');
const { verifyClientCredentials } = require('../../services/auth-service');
const setupRouter = require('../setup');

const app = express();
app.use(express.json());
app.set('trust proxy', false);
app.use('/api/setup', setupRouter);

// Catch-all error handler so test failures are not swallowed silently
app.use((err, req, res, _next) => {
 res.status(500).json({ error: err.message });
});

const VALID_BODY = {
 client_id: 'cli_abc123',
 client_secret: 'plain_secret',
 branch_name: 'Chi nhánh Q1',
 location: 'HCM',
};

describe('POST /api/setup/register-branch', () => {
 beforeEach(() => {
 jest.clearAllMocks();
 verifyClientCredentials.mockResolvedValue({ id: 'cli_abc123', name: 'Acme Corp' });
 stmts.insertBranch.run.mockResolvedValue({ rowCount: 1 });
 stmts.getBranchByClientAndName.get.mockResolvedValue(null);
 });

 test('happy path: 201 with branch_id + agent_token + topic_prefix', async () => {
 const res = await request(app)
 .post('/api/setup/register-branch')
 .send(VALID_BODY)
 .set('Content-Type', 'application/json');

 expect(res.status).toBe(201);
 expect(res.body.branch_id).toMatch(/^br_[a-f0-9]+$/);
 expect(res.body.agent_token).toMatch(/^[a-f0-9]{64}$/);
 expect(res.body.topic_prefix).toBe('company/printer');
 expect(stmts.insertBranch.run).toHaveBeenCalledTimes(1);
 const call = stmts.insertBranch.run.mock.calls[0][0];
 expect(call.client_id).toBe('cli_abc123');
 expect(call.name).toBe('Chi nhánh Q1');
 expect(call.location).toBe('HCM');
 expect(call.agent_token_hash).toMatch(/^[a-f0-9]{64}$/);
 });

 test('bad client_secret: 401, no DB write', async () => {
 verifyClientCredentials.mockResolvedValue(null);

 const res = await request(app)
 .post('/api/setup/register-branch')
 .send(VALID_BODY)
 .set('Content-Type', 'application/json');

 expect(res.status).toBe(401);
 expect(res.body.error).toBe('Invalid client credentials');
 expect(stmts.insertBranch.run).not.toHaveBeenCalled();
 });

 test('missing branch_name: 400, no DB write', async () => {
 const { branch_name: _ignored, ...body } = VALID_BODY;

 const res = await request(app)
 .post('/api/setup/register-branch')
 .send(body)
 .set('Content-Type', 'application/json');

 expect(res.status).toBe(400);
 expect(res.body.error).toMatch(/client_id, client_secret, branch_name required/);
 expect(stmts.insertBranch.run).not.toHaveBeenCalled();
 });

 test('branch_name too long (101 chars): 400', async () => {
 const res = await request(app)
 .post('/api/setup/register-branch')
 .send({ ...VALID_BODY, branch_name: 'a'.repeat(101) })
 .set('Content-Type', 'application/json');

 expect(res.status).toBe(400);
 expect(res.body.error).toMatch(/branch_name must be 1-100 chars/);
 expect(stmts.insertBranch.run).not.toHaveBeenCalled();
 });

 test('branch_name 100 chars: accepted (boundary)', async () => {
 const res = await request(app)
 .post('/api/setup/register-branch')
 .send({ ...VALID_BODY, branch_name: 'a'.repeat(100) })
 .set('Content-Type', 'application/json');

 expect(res.status).toBe(201);
 });

 test('duplicate branch_name (same client): 409', async () => {
 stmts.insertBranch.run.mockRejectedValue({ code: '23505' });
 stmts.getBranchByClientAndName.get.mockResolvedValue({
 id: 'br_existing', name: 'Chi nhánh Q1', client_id: 'cli_abc123',
 });

 const res = await request(app)
 .post('/api/setup/register-branch')
 .send(VALID_BODY)
 .set('Content-Type', 'application/json');

 expect(res.status).toBe(409);
 expect(res.body.error).toMatch(/already exists for this client/);
 expect(res.body.branch_id).toBe('br_existing');
 });
});
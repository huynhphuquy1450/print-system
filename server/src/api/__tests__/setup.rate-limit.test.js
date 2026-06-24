'use strict';

// Isolated rate-limit test for POST /api/setup/register-branch.
// Uses jest.isolateModules to get a fresh rate-limiter instance with
// a low max (3) — proves the middleware enforces the per-IP/hour cap.

jest.mock('../../db', () => ({
 stmts: {
 insertBranch: { run: jest.fn().mockResolvedValue({ rowCount: 1 }) },
 getBranchByClientAndName: { get: jest.fn().mockResolvedValue(null) },
 },
}));

jest.mock('../../services/auth-service', () => ({
 verifyClientCredentials: jest.fn().mockResolvedValue({ id: 'cli_abc', name: 'X' }),
}));

let app;
let request;

beforeAll(() => {
 jest.isolateModules(() => {
 jest.doMock('../../config', () => {
 const actual = jest.requireActual('../../config');
 return { ...actual, rateLimit: { ...actual.rateLimit, setupRegisterPerHour: 3 } };
 });
 const express = require('express');
 const setupRouter = require('../setup');
 app = express();
 app.use(express.json());
 app.set('trust proxy', false);
 app.use('/api/setup', setupRouter);
 app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
 request = require('supertest');
 });
});

const VALID_BODY = { client_id: 'cli_abc', client_secret: 's', branch_name: 'B1' };

describe('POST /api/setup/register-branch — rate limit (isolated max=3)', () => {
 test('4th request from same IP returns 429', async () => {
 const responses = [];
 for (let i = 0; i < 4; i++) {
 const res = await request(app)
 .post('/api/setup/register-branch')
 .send(VALID_BODY)
 .set('Content-Type', 'application/json');
 responses.push(res.status);
 }
 expect(responses[0]).toBe(201);
 expect(responses[1]).toBe(201);
 expect(responses[2]).toBe(201);
 expect(responses[3]).toBe(429);
 });
});
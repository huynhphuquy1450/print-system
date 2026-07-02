'use strict';

// Tests for server/scripts/gen-client.js — dual output mode.
// We require the script directly (jest.mock db + config) so we can test
// the exported createClient + writeInstallFile functions in-process,
// then test the CLI mode by calling the function and checking output.

jest.mock('../../src/db', () => ({
 stmts: {
 insertClient: { run: jest.fn() },
 getClientByName: { get: jest.fn() },
 },
}));

jest.mock('../../src/config', () => ({
 server: { publicUrl: 'http://localhost:3000' },
 mqtt: { topicPrefix: 'company/printer' },
 rateLimit: { setupRegisterPerHour: 5 },
}));

const fs = require('fs');
const path = require('path');
const os = require('os');
const { stmts } = require('../../src/db');
const { createClient, writeInstallFile, publicUrlIsLocalhost } = require('../gen-client');

describe('gen-client (createClient + writeInstallFile)', () => {
 beforeEach(() => {
 jest.clearAllMocks();
 stmts.getClientByName.get.mockReturnValue(null);
 stmts.insertClient.run.mockReturnValue({ rowCount: 1 });
 });

 describe('createClient', () => {
 test('returns id, secret, name for new client', async () => {
 const result = await createClient('Acme Corp');
 expect(result.name).toBe('Acme Corp');
 expect(result.id).toMatch(/^cli_[a-f0-9]+$/);
 expect(typeof result.secret).toBe('string');
 expect(result.secret.length).toBeGreaterThan(40);
 expect(stmts.insertClient.run).toHaveBeenCalledTimes(1);
 const args = stmts.insertClient.run.mock.calls[0][0];
 expect(args.id).toBe(result.id);
 expect(args.name).toBe('Acme Corp');
 expect(args.secret_hash).toMatch(/^\$2[aby]\$/); // bcrypt hash
 expect(args.is_active).toBe(1);
 expect(typeof args.created_at).toBe('number');
 });

 test('throws with code CLIENT_EXISTS if name already taken', async () => {
 stmts.getClientByName.get.mockReturnValue({ id: 'cli_existing', name: 'Acme' });
 await expect(createClient('Acme')).rejects.toThrow(/already exists/);
 await expect(createClient('Acme')).rejects.toMatchObject({ code: 'CLIENT_EXISTS' });
 });
 });

 describe('writeInstallFile', () => {
 test('writes JSON with correct shape', () => {
 const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-client-test-'));
 const outPath = path.join(tmpDir, 'install.json');
 try {
 const payload = {
 server_url: 'http://localhost:3000',
 client_id: 'cli_abc',
 client_secret: 'plaintext-secret',
 client_name: 'Acme',
 created_at: '2026-06-24T16:00:00.000Z',
 };
 const result = writeInstallFile(payload, outPath);
 expect(result).toBe(outPath);

 const fileContent = fs.readFileSync(outPath, 'utf8');
 const data = JSON.parse(fileContent);
 expect(data).toEqual(payload);
 } finally {
 fs.rmSync(tmpDir, { recursive: true, force: true });
 }
 });

 test('file mode is 0o600 (owner read/write only)', () => {
 const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-client-test-'));
 const outPath = path.join(tmpDir, 'install.json');
 try {
 writeInstallFile({ test: 1 }, outPath);
 const stat = fs.statSync(outPath);
 if (process.platform !== 'win32') {
 expect(stat.mode & 0o777).toBe(0o600);
 }
 } finally {
 fs.rmSync(tmpDir, { recursive: true, force: true });
 }
 });

 test('creates parent directory if missing', () => {
 const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-client-test-'));
 const outPath = path.join(tmpDir, 'nested', 'subdir', 'install.json');
 try {
 writeInstallFile({ test: 1 }, outPath);
 expect(fs.existsSync(outPath)).toBe(true);
 } finally {
 fs.rmSync(tmpDir, { recursive: true, force: true });
 }
 });
 });

 describe('publicUrlIsLocalhost (B1 guard)', () => {
 test('nhận diện localhost / 127.0.0.1 / 0.0.0.0 → true', () => {
 expect(publicUrlIsLocalhost('http://localhost:3000')).toBe(true);
 expect(publicUrlIsLocalhost('https://127.0.0.1:443')).toBe(true);
 expect(publicUrlIsLocalhost('http://0.0.0.0:3000')).toBe(true);
 expect(publicUrlIsLocalhost('http://localhost')).toBe(true);
 });
 test('URL server thật / rỗng → false', () => {
 expect(publicUrlIsLocalhost('https://print.example.com')).toBe(false);
 expect(publicUrlIsLocalhost('http://203.0.113.5:3000')).toBe(false);
 expect(publicUrlIsLocalhost('http://localhost-evil.com')).toBe(false);
 expect(publicUrlIsLocalhost('')).toBe(false);
 expect(publicUrlIsLocalhost(undefined)).toBe(false);
 });
 });
});

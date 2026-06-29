'use strict';

// Tests for agent/register.js — the self-service onboarding CLI used by
// branch IT to claim a branch_id + agent_token from the install JSON.

const fs = require('fs');
const path = require('path');
const os = require('os');

const register = require('../register');

function makeInstall(tmpDir) {
 const install = {
 server_url: 'http://localhost:3000',
 client_id: 'cli_test_123',
 client_secret: 'plaintext_secret',
 client_name: 'Acme Corp',
 created_at: '2026-06-24T16:00:00.000Z',
 // gen-client.js luôn sinh agent_env → install.json thực tế đầy đủ key hạ tầng.
 agent_env: {
 MQTT_URL: 'mqtts://host:8883',
 MQTT_USER: 'printservice',
 MQTT_PASS: 'broker_pass',
 MQTT_CA_FILE: 'C:\\print-system\\root_ca.crt',
 API_URL: 'http://localhost:3000',
 SUMATRA_PATH: 'C:\\print-system\\tools\\SumatraPDF.exe',
 },
 };
 const p = path.join(tmpDir, 'install.json');
 fs.writeFileSync(p, JSON.stringify(install, null, 2));
 return p;
}

describe('agent --register', () => {
 let tmpDir;
 beforeEach(() => {
 tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-register-'));
 });
 afterEach(() => {
 fs.rmSync(tmpDir, { recursive: true, force: true });
 delete process.env.REGISTER_BRANCH_NAME;
 delete process.env.REGISTER_LOCATION;
 });

 test('happy path: writes .env with correct keys', async () => {
 const installPath = makeInstall(tmpDir);
 const envPath = path.join(tmpDir, '.env');
 fs.writeFileSync(envPath, 'EXISTING_KEY=keep_me\n');

 const fakeFetch = jest.fn().mockResolvedValue({
 ok: true,
 status: 201,
 json: async () => ({
 branch_id: 'br_xyz',
 agent_token: 'a'.repeat(64),
 topic_prefix: 'company/printer',
 }),
 });

 const result = await register(installPath, {
 fetch: fakeFetch,
 injectPrompts: { branchName: 'Chi nhánh Q1', location: 'HCM' },
 envPath,
 });

 expect(fakeFetch).toHaveBeenCalledTimes(1);
 const [calledUrl, calledOpts] = fakeFetch.mock.calls[0];
 expect(calledUrl).toBe('http://localhost:3000/api/setup/register-branch');
 expect(calledOpts.method).toBe('POST');
 const body = JSON.parse(calledOpts.body);
 expect(body.client_id).toBe('cli_test_123');
 expect(body.client_secret).toBe('plaintext_secret');
 expect(body.branch_name).toBe('Chi nhánh Q1');
 expect(body.location).toBe('HCM');

 expect(result.branch_id).toBe('br_xyz');
 expect(result.envPath).toBe(envPath);

 const envContent = fs.readFileSync(envPath, 'utf8');
 expect(envContent).toMatch(/EXISTING_KEY=keep_me/);
 expect(envContent).toMatch(/^SERVER_URL=http:\/\/localhost:3000$/m);
 expect(envContent).toMatch(/^BRANCH_ID=br_xyz$/m);
 expect(envContent).toMatch(/^AGENT_TOKEN=a{64}$/m);
 expect(envContent).toMatch(/^MQTT_TOPIC_PREFIX=company\/printer$/m);
 });

 test('install.json có agent_env → .env chứa đầy đủ key hạ tầng', async () => {
 const install = {
 server_url: 'http://localhost:3000',
 client_id: 'cli_test_123',
 client_secret: 'plaintext_secret',
 client_name: 'Acme Corp',
 created_at: '2026-06-24T16:00:00.000Z',
 agent_env: {
 MQTT_URL: 'mqtts://host:8883',
 MQTT_USER: 'printservice',
 MQTT_PASS: 'broker_pass',
 API_URL: 'https://host:443',
 MQTT_CA_FILE: 'C:\\print-system\\root_ca.crt',
 SUMATRA_PATH: 'C:\\print-system\\tools\\SumatraPDF.exe',
 },
 };
 const installPath = path.join(tmpDir, 'install.json');
 fs.writeFileSync(installPath, JSON.stringify(install, null, 2));
 const envPath = path.join(tmpDir, '.env');

 const fakeFetch = jest.fn().mockResolvedValue({
 ok: true,
 status: 201,
 json: async () => ({
 branch_id: 'br_xyz',
 agent_token: 'a'.repeat(64),
 topic_prefix: 'company/printer',
 }),
 });

 await register(installPath, {
 fetch: fakeFetch,
 injectPrompts: { branchName: 'Chi nhánh Q1', location: 'HCM' },
 envPath,
 });

 const envContent = fs.readFileSync(envPath, 'utf8');
 expect(envContent).toMatch(/^BRANCH_ID=br_xyz$/m);
 expect(envContent).toMatch(/^MQTT_URL=mqtts:\/\/host:8883$/m);
 expect(envContent).toMatch(/^MQTT_USER=printservice$/m);
 expect(envContent).toMatch(/^MQTT_PASS=broker_pass$/m);
 expect(envContent).toMatch(/^API_URL=https:\/\/host:443$/m);
 expect(envContent).toMatch(/^SUMATRA_PATH=C:\\print-system\\tools\\SumatraPDF\.exe$/m);
 });

 test('non-interactive: REGISTER_BRANCH_NAME/LOCATION env → bỏ qua readline, ghi .env', async () => {
 const installPath = makeInstall(tmpDir);
 const envPath = path.join(tmpDir, '.env');
 process.env.REGISTER_BRANCH_NAME = 'Chi nhánh ENV';
 process.env.REGISTER_LOCATION = 'Đà Nẵng';

 const fakeFetch = jest.fn().mockResolvedValue({
 ok: true,
 status: 201,
 json: async () => ({
 branch_id: 'br_env',
 agent_token: 'b'.repeat(64),
 topic_prefix: 'company/printer',
 }),
 });

 // readline mock sẽ throw nếu bị gọi — chứng minh nhánh env không chạm tới readline.
 const fakeReadline = { createInterface: () => { throw new Error('readline không được gọi'); } };

 const result = await register(installPath, { fetch: fakeFetch, readline: fakeReadline, envPath });

 const body = JSON.parse(fakeFetch.mock.calls[0][1].body);
 expect(body.branch_name).toBe('Chi nhánh ENV');
 expect(body.location).toBe('Đà Nẵng');
 expect(result.branch_id).toBe('br_env');

 const envContent = fs.readFileSync(envPath, 'utf8');
 expect(envContent).toMatch(/^BRANCH_ID=br_env$/m);
 expect(envContent).toMatch(/^AGENT_TOKEN=b{64}$/m);
 });

 test('server 401 → throws with status, no .env write', async () => {
 const installPath = makeInstall(tmpDir);
 const envPath = path.join(tmpDir, '.env');
 fs.writeFileSync(envPath, 'BEFORE=yes\n');

 const fakeFetch = jest.fn().mockResolvedValue({
 ok: false,
 status: 401,
 statusText: 'Unauthorized',
 json: async () => ({ error: 'Invalid client credentials' }),
 });

 await expect(register(installPath, {
 fetch: fakeFetch,
 injectPrompts: { branchName: 'B1' },
 envPath,
 })).rejects.toMatchObject({
 status: 401,
 message: expect.stringContaining('Invalid client credentials'),
 });

 // .env unchanged
 const envContent = fs.readFileSync(envPath, 'utf8');
 expect(envContent).toBe('BEFORE=yes\n');
 });

 test('server 409 (duplicate name) → user-friendly error', async () => {
 const installPath = makeInstall(tmpDir);
 const envPath = path.join(tmpDir, '.env');

 const fakeFetch = jest.fn().mockResolvedValue({
 ok: false,
 status: 409,
 statusText: 'Conflict',
 json: async () => ({
 error: "Branch 'B1' already exists for this client",
 }),
 });

 await expect(register(installPath, {
 fetch: fakeFetch,
 injectPrompts: { branchName: 'B1' },
 envPath,
 })).rejects.toThrow(/already exists/);

 // .env not created
 expect(fs.existsSync(envPath)).toBe(false);
 });

 test('install file missing required fields → throws early', async () => {
 const installPath = path.join(tmpDir, 'install.json');
 fs.writeFileSync(installPath, JSON.stringify({ server_url: 'http://x' }));

 await expect(register(installPath, {
 fetch: jest.fn(),
 injectPrompts: { branchName: 'B1' },
 envPath: path.join(tmpDir, '.env'),
 })).rejects.toThrow(/missing required fields/);
 });

 test('branch_name empty (from prompt) → throws', async () => {
 const installPath = makeInstall(tmpDir);
 const envPath = path.join(tmpDir, '.env');

 // Mock readline to return empty branch name
 const fakeRl = {
 question: (_q, cb) => cb(''),
 close: () => {},
 };
 const fakeReadline = { createInterface: () => fakeRl };

 await expect(register(installPath, {
 fetch: jest.fn(),
 readline: fakeReadline,
 envPath,
 })).rejects.toThrow(/branch_name required/);
 });

 test('install.json THIẾU agent_env → throw hướng dẫn tạo lại, không gọi fetch / không ghi .env', async () => {
 const install = {
 server_url: 'http://localhost:3000',
 client_id: 'cli_test_123',
 client_secret: 'plaintext_secret',
 }; // không có agent_env (install.json cũ)
 const installPath = path.join(tmpDir, 'install.json');
 fs.writeFileSync(installPath, JSON.stringify(install));
 const envPath = path.join(tmpDir, '.env');
 const fakeFetch = jest.fn();

 await expect(register(installPath, {
 fetch: fakeFetch,
 injectPrompts: { branchName: 'B1' },
 envPath,
 })).rejects.toThrow(/agent_env/);

 expect(fakeFetch).not.toHaveBeenCalled();
 expect(fs.existsSync(envPath)).toBe(false);
 });

 test('re-register: value chứa $ ghi nguyên văn vào .env (không bị String.replace mangle)', async () => {
 const installPath = makeInstall(tmpDir);
 const envPath = path.join(tmpDir, '.env');
 // .env đã có AGENT_TOKEN → đi nhánh replace (không phải append) — nơi dễ dính bug ký tự $.
 fs.writeFileSync(envPath, 'AGENT_TOKEN=old_value\n');

 const fakeFetch = jest.fn().mockResolvedValue({
 ok: true,
 status: 201,
 json: async () => ({
 branch_id: 'br_dollar',
 agent_token: 'tok$1en$&special',
 topic_prefix: 'company/printer',
 }),
 });

 await register(installPath, {
 fetch: fakeFetch,
 injectPrompts: { branchName: 'B1' },
 envPath,
 });

 const envContent = fs.readFileSync(envPath, 'utf8');
 expect(envContent).toMatch(/^AGENT_TOKEN=tok\$1en\$&special$/m);
 });
});
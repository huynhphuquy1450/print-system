'use strict';

/**
 * agent --register <install.json>
 *
 * Self-service branch onboarding (Task 7 / §10.1 #5). Reads install JSON
 * (produced by `gen-client.js` with OUTPUT_FILE), prompts for branch name
 * + location, POSTs to /api/setup/register-branch, receives branch_id +
 * agent_token, and writes/updates .env.
 *
 * The same install file can be reused to register multiple branches (run
 * `agent --register install.json` once per branch).
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DEFAULT_ENV_PATH = path.join(__dirname, '..', '.env');

function askQuestion(rl, question) {
 return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
}

/**
 * Update .env in-place: preserve existing keys, add/replace the keys in `updates`.
 * Uses regex per-key so we don't disturb unrelated lines.
 */
function updateEnvContent(currentContent, updates) {
 let out = currentContent || '';
 for (const [k, v] of Object.entries(updates)) {
 const re = new RegExp(`^${k}=.*$`, 'm');
 const line = `${k}=${v}`;
 if (re.test(out)) {
 out = out.replace(re, line);
 } else {
 out += (out.length && !out.endsWith('\n') ? '\n' : '') + line + '\n';
 }
 }
 return out;
}

/**
 * @param {string} installPath - path to install JSON file
 * @param {object} [deps] - injectable deps for testing
 * @param {typeof fetch} [deps.fetch] - fetch impl (default: global fetch)
 * @param {object} [deps.readline] - readline module (default: require('readline'))
 * @param {string} [deps.envPath] - path to .env file (default: ../.env)
 * @param {boolean} [deps.dryRun] - if true, skip writing .env (test only)
 * @param {{branchName: string, location?: string}} [deps.injectPrompts] -
 * skip readline, use these values (test only)
 * @returns {Promise<{branch_id: string, agent_token: string, envPath: string, envContent: string}>}
 */
async function register(installPath, deps = {}) {
 const fetchImpl = deps.fetch || global.fetch;
 const rlMod = deps.readline || readline;
 const envPath = deps.envPath || DEFAULT_ENV_PATH;

 // 1. Read + validate install file
 const installRaw = fs.readFileSync(installPath, 'utf8');
 const install = JSON.parse(installRaw);
 if (!install.server_url || !install.client_id || !install.client_secret) {
 throw new Error('Install file missing required fields (server_url, client_id, client_secret)');
 }

 // 2. Prompt for branch_name + location (or use injected values)
 let branchName;
 let location;
 if (deps.injectPrompts) {
 branchName = deps.injectPrompts.branchName;
 location = deps.injectPrompts.location || '';
 } else {
 const rl = rlMod.createInterface({ input: process.stdin, output: process.stdout });
 try {
 branchName = await askQuestion(rl, 'Tên chi nhánh (vd: Chi nhánh Quận 1): ');
 location = await askQuestion(rl, 'Địa điểm (optional, Enter để bỏ qua): ');
 } finally {
 rl.close();
 }
 }
 if (!branchName) throw new Error('branch_name required');

 // 3. POST to server
 const res = await fetchImpl(`${install.server_url}/api/setup/register-branch`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 client_id: install.client_id,
 client_secret: install.client_secret,
 branch_name: branchName,
 location: location || undefined,
 }),
 });

 if (!res.ok) {
 const body = await res.json().catch(() => ({}));
 const err = new Error(`Registration failed (${res.status}): ${body.error || res.statusText}`);
 err.status = res.status;
 err.body = body;
 throw err;
 }

 const { branch_id, agent_token, topic_prefix } = await res.json();

 // 4. Update .env (preserve existing keys)
 let envContent = '';
 try {
 envContent = fs.readFileSync(envPath, 'utf8');
 } catch (e) {
 /* .env may not exist yet — that's fine */
 }
 const updates = {
 SERVER_URL: install.server_url,
 BRANCH_ID: branch_id,
 AGENT_TOKEN: agent_token,
 MQTT_TOPIC_PREFIX: topic_prefix,
 };
 const newContent = updateEnvContent(envContent, updates);

 if (!deps.dryRun) {
 fs.writeFileSync(envPath, newContent);
 }

 return { branch_id, agent_token, envPath, envContent: newContent };
}

module.exports = register;

// CLI mode
if (require.main === module) {
 const installPath = process.argv[2];
 if (!installPath) {
 console.error('Usage: node register.js <install.json>');
 process.exit(1);
 }
 register(installPath)
 .then((r) => {
 console.log(`\n✓ Registered as ${r.branch_id}`);
 console.log(`✓ Saved to ${r.envPath}`);
 console.log('\nNext step: run \'node agent.js\' to start printing.');
 process.exit(0);
 })
 .catch((e) => {
 console.error('✗', e.message);
 process.exit(1);
 });
}

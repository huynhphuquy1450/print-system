'use strict';

const path = require('path');

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

function required(name) {
 const v = process.env[name];
 if (!v || v.trim() === '') {
 throw new Error(`Missing required env var: ${name}`);
 }
 return v;
}

function optional(name, def) {
 return process.env[name] || def;
}

const config = {
 env: optional('NODE_ENV', 'development'),
 port: parseInt(optional('PORT', '3000'), 10),
 startedAt: Date.now(),

 db: {
 url: optional('DATABASE_URL', null),
 path: optional('DB_PATH', './data/jobs.db'),
 backupsDir: optional('DB_BACKUPS_DIR', './data/backups'),
 retentionBackupsDays: parseInt(optional('DB_BACKUP_RETENTION_DAYS', '30'), 10),
 },

 storage: {
 path: optional('STORAGE_PATH', './storage'),
 retentionDays: parseInt(optional('STORAGE_RETENTION_DAYS', '7'), 10),
 },

 // Audit log retention (HM5): purge dòng audit_log cũ hơn N ngày (chạy cùng giờ cleanup).
 audit: {
 retentionDays: parseInt(optional('AUDIT_RETENTION_DAYS', '90'), 10),
 },

 // Alerts retention: purge dòng alerts cũ hơn N ngày (chạy cùng giờ cleanup). 0/âm = tắt purge.
 alerts: {
 retentionDays: parseInt(optional('ALERTS_RETENTION_DAYS', '90'), 10),
 },

 mqtt: {
 url: required('MQTT_URL'),
 username: required('MQTT_USER'),
 password: required('MQTT_PASS'),
 caFile: optional('MQTT_CA_FILE', '/etc/mosquitto/certs/server.crt'),
 rejectUnauthorized: optional('MQTT_REJECT_UNAUTHORIZED', 'true') === 'true',
 qos: 1,
 topicPrefix: optional('MQTT_TOPIC_PREFIX', 'company/printer'),
 clientId: optional('MQTT_CLIENT_ID', `print-service-${process.pid}`),
 reconnectPeriod: 5000,
 connectTimeout: 30000,
 },

 jwt: {
 secret: required('JWT_SECRET'),
 agentSecret: required('AGENT_TOKEN_SECRET'),
 expiresIn: optional('JWT_EXPIRES_IN', '7d'),
 algorithm: 'HS256',
 },

 // ACL: Hash agent_token như thế nào - SHA256 (token là random hex 64 chars, đủ entropy)
 agentTokenHashAlgo: 'sha256',

 cron: {
 retryIntervalMin: parseInt(optional('RETRY_INTERVAL_MIN', '5'), 10),
 staleJobMin: parseInt(optional('STALE_JOB_MIN', '5'), 10),
 maxRetries: parseInt(optional('MAX_RETRIES', '5'), 10),
 cleanupHour: parseInt(optional('CLEANUP_HOUR', '3'), 10),
 backupHour: parseInt(optional('BACKUP_HOUR', '2'), 10),
 },

 // Presence/offline detection (TASK 6+8). freshMs: web coi trạm là 'tươi' (UI, expose qua
 // /api/v1/config). offlineMs: cron hạ status='offline' khi last_seen_at quá hạn (rộng hơn
 // freshMs để tránh nhấp nháy khi agent trễ heartbeat). checkIntervalMs: tần suất cron quét.
 presence: {
 freshMs: parseInt(optional('PRESENCE_FRESH_MS', '60000'), 10),
 offlineMs: parseInt(optional('PRESENCE_OFFLINE_MS', '120000'), 10),
 checkIntervalMs: parseInt(optional('PRESENCE_CHECK_INTERVAL_MS', '30000'), 10),
 },

 // Pluggable rate-limit store: set REDIS_URL → dùng Redis (counter chia sẻ giữa nhiều node).
 // Không set → in-process MemoryStore (đủ single-server). Chỉ cần khi scale ngang.
 redis: {
 url: optional('REDIS_URL', null),
 },

 // Webhook outbound (HM4): allowlist domain ERP (opt-in). CSV host được phép; rỗng = tắt
 // allowlist (vẫn luôn chặn IP nội bộ qua SSRF guard). Khớp exact host hoặc subdomain.
 webhook: {
 allowedHosts: optional('WEBHOOK_ALLOWED_HOSTS', '')
 .split(',')
 .map((s) => s.trim().toLowerCase())
 .filter(Boolean),
 },

 rateLimit: {
 // Per-IP login rate limit: chống brute force password
 authLoginPerMin: parseInt(optional('AUTH_LOGIN_RATE_PER_MIN', '5'), 10),
 // Per-client write rate limit: chống HQ spam POST jobs/branches/printers/agents
 clientWritePerMin: parseInt(optional('CLIENT_WRITE_RATE_PER_MIN', '30'), 10),
 // Per-IP self-service branch registration: chống brute force client_secret +
 // branch-name squatting. Registration rarer than login → hourly window.
 setupRegisterPerHour: parseInt(optional('SETUP_REGISTER_RATE_PER_HOUR', '5'), 10),
 },

 server: {
 // Public URL of this server (used in install JSON, defaults to http://localhost:$PORT)
 publicUrl: optional('SERVER_PUBLIC_URL', `http://localhost:${optional('PORT', '3000')}`),
 },

 // HTTPS — for agents accessing the API over the public internet.
 // HTTP (port) is kept for HQ LAN access. When HTTPS is enabled, an additional
 // https.createServer binds to https.port using cert/key from disk.
 // Certs are loaded from Step-CA (see scripts/setup-step-ca.sh).
 https: {
 enabled: optional('HTTPS_ENABLED', 'false') === 'true',
 port: parseInt(optional('HTTPS_PORT', '443'), 10),
 certFile: optional('HTTPS_CERT_FILE', path.join(__dirname, '..', 'certs', 'server.crt')),
 keyFile: optional('HTTPS_KEY_FILE', path.join(__dirname, '..', 'certs', 'server.key')),
 },

 // Topic prefix helper
 jobTopic(branchId) {
 return `${this.mqtt.topicPrefix}/${branchId}/jobs`;
 },
 statusTopic() {
 return `${this.mqtt.topicPrefix}/status`;
 },
};

module.exports = config;
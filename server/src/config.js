'use strict';

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
    path: optional('DB_PATH', './data/jobs.db'),
    backupsDir: optional('DB_BACKUPS_DIR', './data/backups'),
    retentionBackupsDays: parseInt(optional('DB_BACKUP_RETENTION_DAYS', '30'), 10),
  },

  storage: {
    path: optional('STORAGE_PATH', './storage'),
    retentionDays: parseInt(optional('STORAGE_RETENTION_DAYS', '7'), 10),
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

  rateLimit: {
    // Per-IP login rate limit: chống brute force password
    authLoginPerMin: parseInt(optional('AUTH_LOGIN_RATE_PER_MIN', '5'), 10),
    // Per-client write rate limit: chống HQ spam POST jobs/branches/printers/agents
    clientWritePerMin: parseInt(optional('CLIENT_WRITE_RATE_PER_MIN', '30'), 10),
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
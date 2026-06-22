'use strict';

// Set dummy env vars BEFORE any module (config.js) is loaded.
// config.js calls required() on these at require-time — without them, tests crash.
// These are fake values used only in the test runner; no real secrets.
process.env.NODE_ENV = 'test';
process.env.MQTT_URL = 'mqtt://localhost:1883';
process.env.MQTT_USER = 'test-user';
process.env.MQTT_PASS = 'test-pass';
process.env.JWT_SECRET = 'test-jwt-secret-not-real-0000000000000000';
process.env.AGENT_TOKEN_SECRET = 'test-agent-secret-not-real-000000000000';
process.env.DB_PATH = ':memory:';

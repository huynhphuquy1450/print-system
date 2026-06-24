'use strict';

const app = require('./app');
const config = require('./config');
const logger = require('./logger');
const mqttClient = require('./mqtt-client');
const retryStale = require('./jobs/retry-stale');
const cleanupFiles = require('./jobs/cleanup-files');
const backupDb = require('./jobs/backup-db');
const { db, pool } = require('./db');

let server = null;
let shuttingDown = false;

async function start() {
 try {
 logger.info('Starting Print Service', {
 env: config.env,
 port: config.port,
 mqtt_url: config.mqtt.url,
 });

 // 0. Initialize Postgres schema (idempotent CREATE TABLE IF NOT EXISTS).
 // Must run before any other DB-using module starts touching the DB.
 await db.initSchema();

 // 1. MQTT
 mqttClient.connect();

 // 2. HTTP
 server = app.listen(config.port, () => {
 logger.info(`HTTP server listening on port ${config.port}`);
 });

 server.on('error', (err) => {
 logger.error('HTTP server error', { err: err.message });
 });

 // 3. Cron jobs
 retryStale.start();
 cleanupFiles.start();
 backupDb.start();

 logger.info('Print Service started successfully');
 } catch (e) {
 logger.error('Failed to start Print Service', { err: e.message, stack: e.stack });
 process.exit(1);
 }
}

async function shutdown(signal) {
 if (shuttingDown) return;
 shuttingDown = true;
 logger.info(`Received ${signal}, shutting down...`);

 try {
 // Stop cron
 retryStale.stop();
 cleanupFiles.stop();
 backupDb.stop();

 // Close HTTP
 if (server) {
 await new Promise((resolve) => server.close(() => resolve()));
 logger.info('HTTP server closed');
 }

 // Disconnect MQTT
 await mqttClient.disconnect();

 // Close pg pool — release all idle connections cleanly.
 await pool.end();
 logger.info('Postgres pool closed');

 logger.info('Print Service stopped');
 process.exit(0);
 } catch (e) {
 logger.error('Error during shutdown', { err: e.message });
 process.exit(1);
 }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
 logger.error('Uncaught exception', { err: err.message, stack: err.stack });
 shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
 logger.error('Unhandled rejection', { reason: String(reason) });
});

start();
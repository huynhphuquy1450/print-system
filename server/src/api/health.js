'use strict';

const express = require('express');
const router = express.Router();
const config = require('../config');
const mqttClient = require('../mqtt-client');
const { db } = require('../db');

/**
 * GET /health
 * Public - không cần auth
 */
router.get('/', (req, res) => {
  let dbOk = false;
  try {
    db.prepare('SELECT 1').get();
    dbOk = true;
  } catch (e) {
    dbOk = false;
  }
  res.json({
    status: dbOk && mqttClient.isConnected() ? 'ok' : 'degraded',
    mqtt: mqttClient.isConnected() ? 'connected' : 'disconnected',
    db: dbOk ? 'ok' : 'error',
    uptime_seconds: Math.floor((Date.now() - config.startedAt) / 1000),
    env: config.env,
  });
});

module.exports = router;
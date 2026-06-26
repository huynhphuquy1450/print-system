'use strict';

const express = require('express');
const router = express.Router();
const config = require('../config');

/**
 * GET /api/v1/config
 * Public - không cần auth. Expose ngưỡng tươi (TASK 8) cho web → 1 nguồn sự thật,
 * web không hard-code FRESH_MS nữa.
 */
router.get('/', (req, res) => {
 res.json({ presence: { freshMs: config.presence.freshMs } });
});

module.exports = router;

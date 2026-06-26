'use strict';

// API v2 — chỗ đặt các feature mới (roadmap Q1 2027): job history/filter/retry (HM3),
// webhooks ERP (HM4), bulk job (HM7). Hiện là khung rỗng; v1 vẫn dùng được qua
// `/api/v1/*` và alias `/api/*`. Mount tại `/api/v2` trong src/app.js.
const express = require('express');
const router = express.Router();

// HM3 — job history/filter/retry + đọc audit log
router.use('/print-jobs', require('./jobs-v2'));
router.use('/audit-log', require('./audit'));
router.use('/alerts', require('./alerts'));
// HM4 — webhook ERP
router.use('/webhooks', require('./webhooks'));
router.use('/clients', require('./clients'));

module.exports = router;

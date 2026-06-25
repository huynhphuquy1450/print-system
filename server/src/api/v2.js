'use strict';

// API v2 — chỗ đặt các feature mới (roadmap Q1 2027): job history/filter/retry (HM3),
// webhooks ERP (HM4), bulk job (HM7). Hiện là khung rỗng; v1 vẫn dùng được qua
// `/api/v1/*` và alias `/api/*`. Mount tại `/api/v2` trong src/app.js.
const express = require('express');
const router = express.Router();

module.exports = router;

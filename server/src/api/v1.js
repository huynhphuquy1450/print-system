'use strict';

// API v1 — gộp toàn bộ router hiện hữu dưới một prefix version.
// Mount ở cả `/api/v1` và alias `/api` (back-compat cho client HQ cũ) — xem src/app.js.
const express = require('express');
const router = express.Router();

const authRouter = require('./auth');
const jobsRouter = require('./jobs');
const branchesRouter = require('./branches');
const printersRouter = require('./printers');
const adminRouter = require('./admin');
const setupRouter = require('./setup');

router.use('/auth', authRouter);
router.use('/print-jobs', jobsRouter);
router.use('/branches', branchesRouter);
router.use('/printers', printersRouter);
router.use('/admin', adminRouter);
router.use('/setup', setupRouter);

module.exports = router;

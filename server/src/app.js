'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const logger = require('./logger');
const { errorHandler } = require('./middleware/error');

const healthRouter = require('./api/health');
const authRouter = require('./api/auth');
const jobsRouter = require('./api/jobs');
const branchesRouter = require('./api/branches');
const printersRouter = require('./api/printers');
const adminRouter = require('./api/admin');

const app = express();

// Security headers
app.use(helmet());

// CORS - GĐ1 allow all, GĐ2 restrict
app.use(cors());

// JSON body parser — 1KB đủ cho mọi endpoint (POST /api/print-jobs giờ dùng multipart)
app.use(express.json({ limit: '1kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Request log
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    logger.info('HTTP request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms,
      ip: req.ip,
    });
  });
  next();
});

// Routes
app.use('/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/print-jobs', jobsRouter);
app.use('/api/branches', branchesRouter);
app.use('/api/printers', printersRouter);
app.use('/api/admin', adminRouter);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Error handler
app.use(errorHandler);

module.exports = app;
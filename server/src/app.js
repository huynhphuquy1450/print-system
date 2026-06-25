'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const logger = require('./logger');
const { errorHandler } = require('./middleware/error');

const healthRouter = require('./api/health');
const v1Router = require('./api/v1');
const v2Router = require('./api/v2');

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
// API versioning: feature mới đặt dưới /api/v2. Endpoint hiện tại phục vụ qua
// /api/v1/* và alias /api/* (back-compat client cũ — giữ tới hết 2027 rồi deprecate).
app.use('/api/v1', v1Router);
app.use('/api/v2', v2Router);
app.use('/api', v1Router); // alias back-compat — mount cuối, sau các prefix có version

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Error handler
app.use(errorHandler);

module.exports = app;
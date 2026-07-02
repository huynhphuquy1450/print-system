'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const logger = require('./logger');
const { errorHandler } = require('./middleware/error');
const { auditLog } = require('./middleware/audit-log');

const healthRouter = require('./api/health');
const v1Router = require('./api/v1');
const v2Router = require('./api/v2');

const app = express();

// SPA web-admin build (web/dist) — gitignored, phải build ở đích trước khi deploy
const WEB_DIST = path.join(__dirname, '..', '..', 'web', 'dist');

// Security headers — CSP tuỳ chỉnh vì helmet ^7.1.0 mặc định default-src 'self' sẽ
// chặn Google Fonts (styleSrc/fontSrc) mà web/index.html dùng cho SPA same-origin này
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
  })
);

// CORS - GĐ1 allow all, GĐ2 restrict
app.use(cors());

// Static assets SPA (web/dist) — đặt sớm, trước express.json/request-log/auditLog để
// asset đã hash tên (css/js) không bị log/audit làm nhiễu. index:false để '/' luôn rơi
// xuống SPA fallback bên dưới (một code path duy nhất trả index.html).
app.use(express.static(WEB_DIST, { index: false }));

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

// Audit log chi tiết (HM5): ghi mọi thao tác ghi + GET nhạy cảm. Đặt sau request-log,
// trước routes — listener res.on('finish') đọc req.client/req.agent/res.locals.audit lúc kết thúc.
app.use(auditLog);

// Routes
app.use('/health', healthRouter);
// API versioning: feature mới đặt dưới /api/v2. Endpoint hiện tại phục vụ qua
// /api/v1/* và alias /api/* (back-compat client cũ — giữ tới hết 2027 rồi deprecate).
app.use('/api/v1', v1Router);
app.use('/api/v2', v2Router);
app.use('/api', v1Router); // alias back-compat — mount cuối, sau các prefix có version

// SPA fallback: mọi GET/HEAD không phải /api hay /health trả index.html (client-side routing).
// Nếu web/dist chưa build (thiếu index.html), sendFile lỗi → next() rơi xuống 404 JSON bên dưới
// thay vì crash. POST/PUT/... hoặc /api/* không khớp router vẫn rơi xuống 404 JSON như cũ.
app.use((req, res, next) => {
  if (
    (req.method === 'GET' || req.method === 'HEAD') &&
    !req.path.startsWith('/api') &&
    !req.path.startsWith('/health')
  ) {
    return res.sendFile(path.join(WEB_DIST, 'index.html'), (err) => {
      if (err) next();
    });
  }
  next();
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Error handler
app.use(errorHandler);

module.exports = app;
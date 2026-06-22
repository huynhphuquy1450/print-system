'use strict';

const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('./config');

// Đảm bảo folder logs tồn tại
const logsDir = path.resolve(__dirname, '..', 'logs');
fs.mkdirSync(logsDir, { recursive: true });

const { combine, timestamp, printf, colorize, errors, splat } = winston.format;

const consoleFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  printf(({ timestamp: ts, level, message, ...meta }) => {
    let metaStr = '';
    if (Object.keys(meta).length > 0) {
      metaStr = ' ' + JSON.stringify(meta);
    }
    return `${ts} [${level}] ${message}${metaStr}`;
  })
);

const fileFormat = combine(
  timestamp(),
  errors({ stack: true }),
  splat(),
  winston.format.json()
);

const logger = winston.createLogger({
  level: config.env === 'production' ? 'info' : 'debug',
  format: fileFormat,
  defaultMeta: { service: 'print-service' },
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 10,
    }),
  ],
});

module.exports = logger;
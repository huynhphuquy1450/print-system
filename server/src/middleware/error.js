'use strict';

const logger = require('../logger');

/**
 * Error handler chuẩn: log unexpected, trả JSON error
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err.status) {
    // HttpError from service
    res.status(err.status).json({ error: err.message });
    return;
  }
  logger.error('Unhandled error', {
    err: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { errorHandler };
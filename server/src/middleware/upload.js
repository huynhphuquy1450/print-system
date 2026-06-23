'use strict';

const multer = require('multer');
const { HttpError } = require('../errors');

const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50 MB — was 50MB effective via express.json + base64 bloat, now true cap

const upload = multer({
 storage: multer.memoryStorage(),
 limits: { fileSize: MAX_PDF_BYTES, files: 1 },
 fileFilter(req, file, cb) {
 if (file.mimetype === 'application/pdf') return cb(null, true);
 cb(new HttpError(400, `Invalid file mimetype '${file.mimetype}', expected application/pdf`));
 },
});

/**
 * Wrap multer's single() so MulterError maps to HttpError(413).
 * Usage: router.post('/', verifyClient, clientRateLimit(), pdfUpload, handler)
 */
function pdfUpload(req, res, next) {
 upload.single('pdf')(req, res, (err) => {
 if (!err) return next();
 next(onMulterError(err));
 });
}

/**
 * Translate multer errors to HttpError. Exported for unit testing.
 * - LIMIT_FILE_SIZE → 413 Payload Too Large
 * - everything else → pass through (multer wraps as MulterError)
 */
function onMulterError(err) {
 if (err && err.code === 'LIMIT_FILE_SIZE') {
 return new HttpError(413, `PDF exceeds ${MAX_PDF_BYTES} bytes`);
 }
 return err;
}

module.exports = { pdfUpload, onMulterError, MAX_PDF_BYTES };
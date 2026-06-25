'use strict';

const multer = require('multer');
const { HttpError } = require('../errors');

const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50 MB — was 50MB effective via express.json + base64 bloat, now true cap
// HM7: số PDF tối đa trong 1 request bulk. Giữ thấp để chặn DoS bộ nhớ:
// memoryStorage buffer toàn bộ → trần RAM/req = MAX_BULK_FILES * MAX_PDF_BYTES (20*50MB ≈ 1GB).
const MAX_BULK_FILES = 20;

function pdfFileFilter(req, file, cb) {
 if (file.mimetype === 'application/pdf') return cb(null, true);
 cb(new HttpError(400, `Invalid file mimetype '${file.mimetype}', expected application/pdf`));
}

const upload = multer({
 storage: multer.memoryStorage(),
 limits: { fileSize: MAX_PDF_BYTES, files: 1 },
 fileFilter: pdfFileFilter,
});

const uploadBulk = multer({
 storage: multer.memoryStorage(),
 limits: { fileSize: MAX_PDF_BYTES, files: MAX_BULK_FILES },
 fileFilter: pdfFileFilter,
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
 if (err && err.code === 'LIMIT_FILE_COUNT') {
 return new HttpError(413, `Too many files (max ${MAX_BULK_FILES})`);
 }
 return err;
}

/**
 * Bulk upload (HM7): nhiều file field 'pdf' (≤ MAX_BULK_FILES). Dùng cho POST /api/v2/print-jobs/bulk.
 */
function pdfUploadBulk(req, res, next) {
 uploadBulk.array('pdf', MAX_BULK_FILES)(req, res, (err) => {
 if (!err) return next();
 next(onMulterError(err));
 });
}

module.exports = { pdfUpload, pdfUploadBulk, onMulterError, MAX_PDF_BYTES, MAX_BULK_FILES };
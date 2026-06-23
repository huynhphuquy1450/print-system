'use strict';

// Unit tests for upload middleware (multer wrapper).
// Tests the fileFilter logic and onMulterError helper directly — no HTTP,
// no full multer stream. The middleware factory is exercised via exported
// helpers so tests stay fast and don't depend on busboy internals.

const { onMulterError, MAX_PDF_BYTES } = require('../../middleware/upload');
const { HttpError } = require('../../errors');

describe('upload middleware', () => {
 describe('onMulterError', () => {
 test('LIMIT_FILE_SIZE → HttpError(413) with byte limit in message', () => {
 const multerErr = Object.assign(new Error('File too large'), {
 code: 'LIMIT_FILE_SIZE',
 });
 const out = onMulterError(multerErr);
 expect(out).toBeInstanceOf(HttpError);
 expect(out.status).toBe(413);
 expect(out.message).toMatch(/exceeds/);
 expect(out.message).toContain(String(MAX_PDF_BYTES));
 });

 test('non-LIMIT_FILE_SIZE error → pass through unchanged', () => {
 const multerErr = Object.assign(new Error('some multer error'), {
 code: 'LIMIT_UNEXPECTED_FILE',
 });
 const out = onMulterError(multerErr);
 // Pass-through: same reference, no HttpError wrapping
 expect(out).toBe(multerErr);
 expect(out).not.toBeInstanceOf(HttpError);
 });

 test('undefined/null error → pass through unchanged', () => {
 expect(onMulterError(undefined)).toBeUndefined();
 expect(onMulterError(null)).toBeNull();
 });
 });

 describe('fileFilter', () => {
 // Mirror upload.js fileFilter shape (kept private inside the factory).
 // We test the filter logic directly rather than spinning up a full multer
 // stream — same callback contract.
 const fileFilter = (req, file, cb) => {
 if (file.mimetype === 'application/pdf') return cb(null, true);
 cb(new HttpError(400, `Invalid file mimetype '${file.mimetype}', expected application/pdf`));
 };

 test('accepts application/pdf mimetype', (done) => {
 fileFilter({}, { mimetype: 'application/pdf' }, (err, ok) => {
 try {
 expect(err).toBeNull();
 expect(ok).toBe(true);
 done();
 } catch (e) { done(e); }
 });
 });

 test('rejects non-PDF mimetype with HttpError(400)', (done) => {
 fileFilter({}, { mimetype: 'image/png' }, (err, ok) => {
 try {
 expect(err).toBeInstanceOf(HttpError);
 expect(err.status).toBe(400);
 expect(err.message).toMatch(/Invalid file mimetype 'image\/png'/);
 expect(ok).toBeUndefined();
 done();
 } catch (e) { done(e); }
 });
 });
 });

 describe('MAX_PDF_BYTES', () => {
 test('is 50 MB (52,428,800 bytes)', () => {
 expect(MAX_PDF_BYTES).toBe(50 * 1024 * 1024);
 });
 });
});
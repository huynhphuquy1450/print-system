'use strict';

/**
 * Validate PDF: check magic bytes (%PDF-)
 * Trả về null nếu OK, error message nếu không
 */
function validatePdf(buf) {
  if (!Buffer.isBuffer(buf)) {
    return 'pdf_base64 must be a base64-encoded string';
  }
  if (buf.length < 8) {
    return 'PDF too small (< 8 bytes)';
  }
  const head = buf.subarray(0, 5).toString('utf8');
  if (head !== '%PDF-') {
    return 'Invalid PDF: missing %PDF- magic bytes';
  }
  return null;
}

module.exports = { validatePdf };
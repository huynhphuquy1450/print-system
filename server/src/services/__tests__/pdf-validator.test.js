'use strict';

const { validatePdf } = require('../pdf-validator');

describe('validatePdf', () => {
  test('returns null for valid PDF buffer (starts with %PDF-)', () => {
    const buf = Buffer.from('%PDF-1.4\n%fake content');
    expect(validatePdf(buf)).toBeNull();
  });

  test('rejects empty buffer', () => {
    const buf = Buffer.alloc(0);
    const err = validatePdf(buf);
    expect(err).toMatch(/PDF too small/);
  });

  test('rejects buffer < 8 bytes', () => {
    const buf = Buffer.from('%PDF-1');  // 6 bytes
    const err = validatePdf(buf);
    expect(err).toMatch(/PDF too small/);
  });

  test('rejects buffer without %PDF- magic bytes', () => {
    const buf = Buffer.from('NOTAPDF1234567890');
    const err = validatePdf(buf);
    expect(err).toMatch(/missing %PDF-/);
  });

  test('rejects non-Buffer input (string)', () => {
    const err = validatePdf('not a buffer');
    expect(err).toMatch(/must be a base64-encoded string/);
  });

  test('rejects non-Buffer input (undefined)', () => {
    const err = validatePdf(undefined);
    expect(err).toMatch(/must be a base64-encoded string/);
  });

  test('rejects non-Buffer input (object)', () => {
    const err = validatePdf({ length: 100 });
    expect(err).toMatch(/must be a base64-encoded string/);
  });

  test('accepts exactly 8-byte PDF', () => {
    const buf = Buffer.from('%PDF-1.4');  // exactly 8 bytes
    expect(validatePdf(buf)).toBeNull();
  });
});

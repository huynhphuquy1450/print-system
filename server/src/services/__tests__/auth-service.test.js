'use strict';

// Mock db.stmts BEFORE requiring auth-service.
// auth-service.js calls `require('../db').stmts.getClientById.get(...)` at top-level require-time,
// so jest.mock must be hoisted to before the require statement.
jest.mock('../../db', () => ({
  stmts: {
    getClientById: { get: jest.fn() },
  },
}));

const { stmts } = require('../../db');
const {
  verifyClientCredentials,
  issueClientJwt,
  verifyClientJwt,
  generateClientSecret,
} = require('../auth-service');

const TEST_CLIENT_ID = 'test_client_001';
const TEST_CLIENT_NAME = 'Acme Corp';
const TEST_CLIENT_SECRET = 'super-secret-password';
const BCRYPT_HASH = '$2a$10$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVW';

describe('auth-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateClientSecret', () => {
    test('returns base64url string (~43 chars for 32 bytes)', () => {
      const secret = generateClientSecret();
      expect(typeof secret).toBe('string');
      expect(secret.length).toBeGreaterThan(40);
      // base64url alphabet: A-Z, a-z, 0-9, -, _
      expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    test('returns unique secrets on each call', () => {
      const s1 = generateClientSecret();
      const s2 = generateClientSecret();
      expect(s1).not.toBe(s2);
    });
  });

  describe('verifyClientCredentials', () => {
    test('returns null if client not found in DB', () => {
      stmts.getClientById.get.mockReturnValue(null);
      expect(verifyClientCredentials('missing', 'pass')).toBeNull();
    });

    test('returns null if client is_active=0', () => {
      stmts.getClientById.get.mockReturnValue({
        id: TEST_CLIENT_ID,
        name: TEST_CLIENT_NAME,
        secret_hash: BCRYPT_HASH,
        is_active: 0,
      });
      expect(verifyClientCredentials(TEST_CLIENT_ID, 'any')).toBeNull();
    });

    test('returns null if bcrypt compare fails (wrong secret)', () => {
      stmts.getClientById.get.mockReturnValue({
        id: TEST_CLIENT_ID,
        name: TEST_CLIENT_NAME,
        secret_hash: BCRYPT_HASH,
        is_active: 1,
      });
      // BCRYPT_HASH is a fake hash, bcrypt.compareSync will return false
      expect(verifyClientCredentials(TEST_CLIENT_ID, 'wrong')).toBeNull();
    });
  });

  describe('issueClientJwt + verifyClientJwt (round-trip)', () => {
    test('token issued by issueClientJwt is verified by verifyClientJwt', () => {
      const client = { id: TEST_CLIENT_ID, name: TEST_CLIENT_NAME };
      const token = issueClientJwt(client);
      const decoded = verifyClientJwt(token);
      expect(decoded).not.toBeNull();
      expect(decoded.sub).toBe(TEST_CLIENT_ID);
      expect(decoded.name).toBe(TEST_CLIENT_NAME);
      expect(decoded.type).toBe('client');
    });

    test('verifyClientJwt returns null for malformed token', () => {
      expect(verifyClientJwt('not.a.jwt')).toBeNull();
    });

    test('verifyClientJwt returns null for empty string', () => {
      expect(verifyClientJwt('')).toBeNull();
    });

    test('verifyClientJwt returns null for null/undefined', () => {
      expect(verifyClientJwt(null)).toBeNull();
      expect(verifyClientJwt(undefined)).toBeNull();
    });
  });
});

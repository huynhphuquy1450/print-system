'use strict';

const { generateAgentToken, hashAgentToken, verifyAgentToken } = require('../token-service');

describe('token-service', () => {
  describe('generateAgentToken', () => {
    test('returns 64-char hex string', () => {
      const token = generateAgentToken();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    test('returns unique tokens on each call', () => {
      const t1 = generateAgentToken();
      const t2 = generateAgentToken();
      expect(t1).not.toBe(t2);
    });
  });

  describe('hashAgentToken', () => {
    test('returns deterministic 64-char hex hash', () => {
      const token = 'abc123';
      const hash1 = hashAgentToken(token);
      const hash2 = hashAgentToken(token);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });

    test('different tokens produce different hashes', () => {
      const h1 = hashAgentToken('token1');
      const h2 = hashAgentToken('token2');
      expect(h1).not.toBe(h2);
    });
  });

  describe('verifyAgentToken', () => {
    test('returns true for matching token + hash', () => {
      const token = generateAgentToken();
      const hash = hashAgentToken(token);
      expect(verifyAgentToken(token, hash)).toBe(true);
    });

    test('returns false for wrong token', () => {
      const token = generateAgentToken();
      const hash = hashAgentToken(token);
      expect(verifyAgentToken('wrong-token', hash)).toBe(false);
    });

    test('returns false when hash length differs (constant-time guard)', () => {
      const token = generateAgentToken();
      const validHash = hashAgentToken(token);
      const truncatedHash = validHash.substring(0, 30);
      expect(verifyAgentToken(token, truncatedHash)).toBe(false);
    });
  });
});

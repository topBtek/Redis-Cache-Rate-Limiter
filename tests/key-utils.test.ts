import { describe, it, expect } from '@jest/globals';
import { sanitizeKey, createKey, createCacheKey, createRateLimitKey } from '../src/utils/key-utils.js';

describe('Key Utilities', () => {
  describe('sanitizeKey', () => {
    it('should sanitize special characters', () => {
      expect(sanitizeKey('test@key#123')).toBe('test_key_123');
      expect(sanitizeKey('key with spaces')).toBe('key_with_spaces');
    });

    it('should preserve allowed characters', () => {
      expect(sanitizeKey('test-key_123:value.here')).toBe('test-key_123:value.here');
    });
  });

  describe('createKey', () => {
    it('should create prefixed key', () => {
      const key = createKey(['test', 'key']);
      expect(key).toContain('cache_rate_limiter');
      expect(key).toContain('test');
      expect(key).toContain('key');
    });
  });

  describe('createCacheKey', () => {
    it('should create cache key with prefix', () => {
      const key = createCacheKey('my-key');
      expect(key).toContain('cache_rate_limiter');
      expect(key).toContain('cache');
      expect(key).toContain('my-key');
    });
  });

  describe('createRateLimitKey', () => {
    it('should create rate limit key with window', () => {
      const key = createRateLimitKey('192.168.1.1', 60);
      expect(key).toContain('cache_rate_limiter');
      expect(key).toContain('ratelimit');
      expect(key).toContain('192.168.1.1');
      expect(key).toContain('w60');
    });
  });
});

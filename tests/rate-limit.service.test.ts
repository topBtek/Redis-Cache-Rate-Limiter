import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { Mock } from 'jest-mock';
import { RateLimitService } from '../src/services/rate-limit.service.js';
import { redisService } from '../src/services/redis.service.js';
import { memoryFallback } from '../src/services/memory-fallback.service.js';

// Mock Redis service
jest.mock('../src/services/redis.service.js', () => ({
  redisService: {
    isRedisConnected: jest.fn(),
    execute: jest.fn(),
  },
}));

describe('RateLimitService', () => {
  let rateLimitService: RateLimitService;

  beforeEach(() => {
    rateLimitService = new RateLimitService();
    memoryFallback.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    memoryFallback.clear();
  });

  describe('checkLimit', () => {
    it('should allow request when under limit', async () => {
      (redisService.isRedisConnected as Mock).mockReturnValue(false);

      const result = await rateLimitService.checkLimit('test-ip', {
        window: 60,
        maxRequests: 10,
      });

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeLessThan(10);
      expect(result.limit).toBe(10);
    });

    it('should block request when over limit', async () => {
      (redisService.isRedisConnected as Mock).mockReturnValue(false);

      // Make 10 requests to hit the limit
      for (let i = 0; i < 10; i++) {
        await rateLimitService.checkLimit('test-ip', {
          window: 60,
          maxRequests: 10,
        });
      }

      // 11th request should be blocked
      const result = await rateLimitService.checkLimit('test-ip', {
        window: 60,
        maxRequests: 10,
      });

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeDefined();
    });

    it('should use Redis when connected', async () => {
      (redisService.isRedisConnected as Mock).mockReturnValue(true);
      (redisService.execute as Mock).mockResolvedValue({
        allowed: true,
        limit: 10,
        remaining: 9,
        reset: Date.now() + 60000,
      });

      const result = await rateLimitService.checkLimit('test-ip', {
        window: 60,
        maxRequests: 10,
      });

      expect(result.allowed).toBe(true);
      expect(redisService.execute).toHaveBeenCalled();
    });

    it('should reset after window expires', async () => {
      (redisService.isRedisConnected as Mock).mockReturnValue(false);

      // Make requests to hit limit
      for (let i = 0; i < 10; i++) {
        await rateLimitService.checkLimit('test-ip', {
          window: 1, // 1 second window
          maxRequests: 10,
        });
      }

      // Should be blocked
      const blocked = await rateLimitService.checkLimit('test-ip', {
        window: 1,
        maxRequests: 10,
      });
      expect(blocked.allowed).toBe(false);

      // Wait for window to expire (simulate by clearing memory)
      memoryFallback.clear();

      // Should be allowed again
      const allowed = await rateLimitService.checkLimit('test-ip', {
        window: 1,
        maxRequests: 10,
      });
      expect(allowed.allowed).toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset rate limit for identifier', async () => {
      (redisService.isRedisConnected as Mock).mockReturnValue(false);

      // Make some requests
      await rateLimitService.checkLimit('test-ip', {
        window: 60,
        maxRequests: 10,
      });

      // Reset
      const result = await rateLimitService.reset('test-ip', 60);
      expect(result).toBe(true);
    });

    it('should reset in Redis when connected', async () => {
      (redisService.isRedisConnected as Mock).mockReturnValue(true);
      (redisService.execute as Mock).mockResolvedValue(1);

      const result = await rateLimitService.reset('test-ip', 60);
      expect(result).toBe(true);
      expect(redisService.execute).toHaveBeenCalled();
    });
  });
});

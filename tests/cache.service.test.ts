import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { Mock } from 'jest-mock';
import { CacheService } from '../src/services/cache.service.js';
import { redisService } from '../src/services/redis.service.js';
import { memoryFallback } from '../src/services/memory-fallback.service.js';

// Mock Redis service
jest.mock('../src/services/redis.service.js', () => ({
  redisService: {
    isRedisConnected: jest.fn(),
    execute: jest.fn(),
  },
}));

describe('CacheService', () => {
  let cacheService: CacheService;

  beforeEach(() => {
    cacheService = new CacheService();
    memoryFallback.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    memoryFallback.clear();
  });

  describe('get', () => {
    it('should return null for non-existent key', async () => {
      (redisService.isRedisConnected as Mock).mockReturnValue(false);
      
      const result = await cacheService.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should get value from Redis when connected', async () => {
      (redisService.isRedisConnected as jest.Mock).mockReturnValue(true);
      (redisService.execute as Mock).mockResolvedValue(JSON.stringify({ foo: 'bar' }));

      const result = await cacheService.get<{ foo: string }>('test-key');
      expect(result).toEqual({ foo: 'bar' });
      expect(redisService.execute).toHaveBeenCalled();
    });

    it('should fallback to memory when Redis is unavailable', async () => {
      (redisService.isRedisConnected as Mock).mockReturnValue(false);
      memoryFallback.set('cache_rate_limiter:cache:test-key', { foo: 'bar' }, 60);

      const result = await cacheService.get<{ foo: string }>('test-key');
      expect(result).toEqual({ foo: 'bar' });
    });

    it('should handle non-JSON values when serialize is false', async () => {
      (redisService.isRedisConnected as Mock).mockReturnValue(true);
      (redisService.execute as Mock).mockResolvedValue('plain-string');

      const result = await cacheService.get<string>('test-key', { serialize: false });
      expect(result).toBe('plain-string');
    });
  });

  describe('set', () => {
    it('should set value in Redis when connected', async () => {
      (redisService.isRedisConnected as Mock).mockReturnValue(true);
      (redisService.execute as Mock).mockResolvedValue('OK');

      const result = await cacheService.set('test-key', { foo: 'bar' }, { ttl: 60 });
      expect(result).toBe(true);
      expect(redisService.execute).toHaveBeenCalled();
    });

    it('should fallback to memory when Redis is unavailable', async () => {
      (redisService.isRedisConnected as Mock).mockReturnValue(false);

      const result = await cacheService.set('test-key', { foo: 'bar' }, { ttl: 60 });
      expect(result).toBe(true);
      
      const cached = memoryFallback.get('cache_rate_limiter:cache:test-key');
      expect(cached).toEqual({ foo: 'bar' });
    });
  });

  describe('delete', () => {
    it('should delete value from Redis when connected', async () => {
      (redisService.isRedisConnected as Mock).mockReturnValue(true);
      (redisService.execute as Mock).mockResolvedValue(1);

      const result = await cacheService.delete('test-key');
      expect(result).toBe(true);
    });

    it('should delete value from memory fallback', async () => {
      (redisService.isRedisConnected as Mock).mockReturnValue(false);
      memoryFallback.set('cache_rate_limiter:cache:test-key', 'value', 60);

      const result = await cacheService.delete('test-key');
      expect(result).toBe(true);
      
      const cached = memoryFallback.get('cache_rate_limiter:cache:test-key');
      expect(cached).toBeNull();
    });
  });

  describe('getOrSet', () => {
    it('should return cached value if exists', async () => {
      (redisService.isRedisConnected as Mock).mockReturnValue(true);
      (redisService.execute as Mock).mockResolvedValue(JSON.stringify('cached-value'));

      const factory = jest.fn().mockResolvedValue('new-value');
      const result = await cacheService.getOrSet('test-key', factory);

      expect(result).toBe('cached-value');
      expect(factory).not.toHaveBeenCalled();
    });

    it('should call factory and cache result on cache miss', async () => {
      (redisService.isRedisConnected as Mock).mockReturnValue(true);
      (redisService.execute as Mock)
        .mockResolvedValueOnce(null) // get returns null
        .mockResolvedValueOnce('OK'); // set succeeds

      const factory = jest.fn().mockResolvedValue('new-value');
      const result = await cacheService.getOrSet('test-key', factory);

      expect(result).toBe('new-value');
      expect(factory).toHaveBeenCalledTimes(1);
    });
  });

  describe('wrap', () => {
    it('should wrap function with caching', async () => {
      (redisService.isRedisConnected as Mock).mockReturnValue(true);
      (redisService.execute as Mock)
        .mockResolvedValueOnce(null) // first call - cache miss
        .mockResolvedValueOnce('OK') // set
        .mockResolvedValueOnce(JSON.stringify('wrapped-value')); // second call - cache hit

      const fn = jest.fn().mockResolvedValue('wrapped-value');
      
      const result1 = await cacheService.wrap('test-key', fn);
      const result2 = await cacheService.wrap('test-key', fn);

      expect(result1).toBe('wrapped-value');
      expect(result2).toBe('wrapped-value');
      expect(fn).toHaveBeenCalledTimes(1); // Only called once due to caching
    });
  });
});

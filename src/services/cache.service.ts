import { redisService } from './redis.service.js';
import { memoryFallback } from './memory-fallback.service.js';
import { createCacheKey } from '../utils/key-utils.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import type { CacheOptions } from '../types/index.js';

export class CacheService {
  /**
   * Get value from cache
   */
  async get<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
    const cacheKey = createCacheKey(key);
    const { serialize = true } = options;

    // Try Redis first
    if (redisService.isRedisConnected()) {
      try {
        const value = await redisService.execute(async (client) => {
          const data = await client.get(cacheKey);
          return data;
        });

        if (value !== null) {
          try {
            return serialize ? JSON.parse(value) : (value as T);
          } catch {
            return value as T;
          }
        }
      } catch (error) {
        logger.warn({ error, key }, 'Redis get failed, falling back to memory');
      }
    }

    // Fallback to memory
    if (config.fallback.memory) {
      const value = memoryFallback.get<T>(cacheKey);
      if (value !== null) {
        logger.debug({ key }, 'Cache hit from memory fallback');
        return value;
      }
    }

    return null;
  }

  /**
   * Set value in cache
   */
  async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<boolean> {
    const cacheKey = createCacheKey(key);
    const { ttl, serialize = true } = options;

    const serialized = serialize ? JSON.stringify(value) : String(value);

    // Try Redis first
    if (redisService.isRedisConnected()) {
      try {
        const result = await redisService.execute(async (client) => {
          if (ttl) {
            return await client.setex(cacheKey, ttl, serialized);
          } else {
            return await client.set(cacheKey, serialized);
          }
        });

        if (result === 'OK') {
          return true;
        }
      } catch (error) {
        logger.warn({ error, key }, 'Redis set failed, falling back to memory');
      }
    }

    // Fallback to memory
    if (config.fallback.memory) {
      memoryFallback.set(cacheKey, value, ttl);
      logger.debug({ key }, 'Cache set in memory fallback');
      return true;
    }

    return false;
  }

  /**
   * Delete value from cache
   */
  async delete(key: string): Promise<boolean> {
    const cacheKey = createCacheKey(key);

    // Try Redis first
    if (redisService.isRedisConnected()) {
      try {
        const result = await redisService.execute(async (client) => {
          return await client.del(cacheKey);
        });

        if (result !== null && result > 0) {
          return true;
        }
      } catch (error) {
        logger.warn({ error, key }, 'Redis delete failed, falling back to memory');
      }
    }

    // Fallback to memory
    if (config.fallback.memory) {
      return memoryFallback.delete(cacheKey);
    }

    return false;
  }

  /**
   * Get or set pattern (cache-aside)
   * If value doesn't exist, call the factory function and cache the result
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    // Try to get from cache
    const cached = await this.get<T>(key, options);
    if (cached !== null) {
      return cached;
    }

    // Cache miss - call factory
    const value = await factory();

    // Store in cache
    await this.set(key, value, options);

    return value;
  }

  /**
   * Wrap a function with caching (cache-aside pattern)
   * Automatically handles cache key generation and TTL
   */
  async wrap<T>(
    key: string,
    fn: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    return this.getOrSet(key, fn, options);
  }

  /**
   * Clear all cache keys with prefix
   */
  async flush(prefix?: string): Promise<number> {
    const flushPrefix = prefix ? createCacheKey(prefix) : config.redis.prefix;
    let count = 0;

    // Try Redis first
    if (redisService.isRedisConnected()) {
      try {
        const result = await redisService.execute(async (client) => {
          const keys = await client.keys(`${flushPrefix}*`);
          if (keys.length > 0) {
            return await client.del(...keys);
          }
          return 0;
        });

        if (result !== null) {
          count += result;
        }
      } catch (error) {
        logger.warn({ error }, 'Redis flush failed, falling back to memory');
      }
    }

    // Fallback to memory
    if (config.fallback.memory) {
      count += memoryFallback.clearPrefix(flushPrefix);
    }

    return count;
  }
}

export const cacheService = new CacheService();

import { redisService } from './redis.service.js';
import { memoryFallback } from './memory-fallback.service.js';
import { createRateLimitKey } from '../utils/key-utils.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import type { RateLimitOptions, RateLimitResult } from '../types/index.js';

/**
 * Sliding Window Log rate limiter
 * Tracks timestamps of requests within a time window
 */
export class RateLimitService {
  /**
   * Check rate limit using sliding window log algorithm
   */
  async checkLimit(
    identifier: string,
    options: RateLimitOptions
  ): Promise<RateLimitResult> {
    const { window, maxRequests } = options;
    const key = createRateLimitKey(identifier, window);
    const now = Date.now();
    const windowMs = window * 1000;

    // Try Redis first
    if (redisService.isRedisConnected()) {
      try {
        const result = await this.checkLimitRedis(key, now, windowMs, maxRequests, window);
        if (result !== null) {
          return result;
        }
      } catch (error) {
        logger.warn({ error, identifier }, 'Redis rate limit check failed, falling back to memory');
      }
    }

    // Fallback to memory
    if (config.fallback.memory) {
      return this.checkLimitMemory(key, now, windowMs, maxRequests);
    }

    // If no fallback, allow the request
    logger.warn('Rate limiting unavailable, allowing request');
    return {
      allowed: true,
      limit: maxRequests,
      remaining: maxRequests - 1,
      reset: now + windowMs,
    };
  }

  private async checkLimitRedis(
    key: string,
    now: number,
    windowMs: number,
    maxRequests: number,
    windowSeconds: number
  ): Promise<RateLimitResult | null> {
    return redisService.execute(async (client) => {
      // Use Redis sorted set to store timestamps
      const cutoff = now - windowMs;

      // Remove old entries
      await client.zremrangebyscore(key, 0, cutoff);

      // Get current count
      const count = await client.zcard(key);

      if (count >= maxRequests) {
        // Get the oldest timestamp to calculate reset time
        const oldest = await client.zrange(key, 0, 0, 'WITHSCORES');
        const oldestTimestamp = oldest.length > 0 ? parseInt(oldest[1]) : now;
        const reset = oldestTimestamp + windowMs;

        return {
          allowed: false,
          limit: maxRequests,
          remaining: 0,
          reset,
          retryAfter: Math.ceil((reset - now) / 1000),
        };
      }

      // Add current request
      await client.zadd(key, now, `${now}-${Math.random()}`);
      await client.expire(key, windowSeconds + 1); // Add 1 second buffer

      return {
        allowed: true,
        limit: maxRequests,
        remaining: maxRequests - count - 1,
        reset: now + windowMs,
      };
    });
  }

  private checkLimitMemory(
    key: string,
    now: number,
    windowMs: number,
    maxRequests: number
  ): RateLimitResult {
    const timestamps = memoryFallback.getRateLimitTimestamps(key);
    const cutoff = now - windowMs;
    const validTimestamps = timestamps.filter((ts) => ts > cutoff);

    if (validTimestamps.length >= maxRequests) {
      const oldestTimestamp = Math.min(...validTimestamps);
      const reset = oldestTimestamp + windowMs;

      return {
        allowed: false,
        limit: maxRequests,
        remaining: 0,
        reset,
        retryAfter: Math.ceil((reset - now) / 1000),
      };
    }

    // Add current request
    memoryFallback.addRateLimitTimestamp(key, now, windowMs / 1000);

    return {
      allowed: true,
      limit: maxRequests,
      remaining: maxRequests - validTimestamps.length - 1,
      reset: now + windowMs,
    };
  }

  /**
   * Reset rate limit for an identifier
   */
  async reset(identifier: string, window: number): Promise<boolean> {
    const key = createRateLimitKey(identifier, window);

    // Try Redis first
    if (redisService.isRedisConnected()) {
      try {
        const result = await redisService.execute(async (client) => {
          return await client.del(key);
        });

        if (result !== null && result > 0) {
          return true;
        }
      } catch (error) {
        logger.warn({ error, identifier }, 'Redis reset failed, falling back to memory');
      }
    }

    // Fallback to memory
    if (config.fallback.memory) {
      return memoryFallback.delete(key);
    }

    return false;
  }
}

export const rateLimitService = new RateLimitService();

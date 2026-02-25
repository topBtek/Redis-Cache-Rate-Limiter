import { redisService } from './redis.service.js';
import { memoryFallback } from './memory-fallback.service.js';
import { createRateLimitKey } from '../utils/key-utils.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import type { RateLimitResult } from '../types/index.js';

export interface TokenBucketOptions {
  capacity: number; // Maximum tokens in bucket
  refillRate: number; // Tokens added per second
  identifier: string;
}

/**
 * Token Bucket rate limiter
 * Alternative algorithm to sliding window log
 * More memory efficient for high-traffic scenarios
 */
export class TokenBucketService {
  /**
   * Check rate limit using token bucket algorithm
   */
  async checkLimit(options: TokenBucketOptions): Promise<RateLimitResult> {
    const { capacity, refillRate, identifier } = options;
    const key = createRateLimitKey(identifier, capacity);
    const now = Date.now();

    // Try Redis first
    if (redisService.isRedisConnected()) {
      try {
        const result = await this.checkLimitRedis(key, now, capacity, refillRate);
        if (result !== null) {
          return result;
        }
      } catch (error) {
        logger.warn({ error, identifier }, 'Redis token bucket check failed, falling back to memory');
      }
    }

    // Fallback to memory
    if (config.fallback.memory) {
      return this.checkLimitMemory(key, now, capacity, refillRate);
    }

    // If no fallback, allow the request
    logger.warn('Token bucket rate limiting unavailable, allowing request');
    return {
      allowed: true,
      limit: capacity,
      remaining: capacity - 1,
      reset: now + (capacity / refillRate) * 1000,
    };
  }

  private async checkLimitRedis(
    key: string,
    now: number,
    capacity: number,
    refillRate: number
  ): Promise<RateLimitResult | null> {
    return redisService.execute(async (client) => {
      // Use Lua script for atomic operations
      const luaScript = `
        local key = KEYS[1]
        local capacity = tonumber(ARGV[1])
        local refillRate = tonumber(ARGV[2])
        local now = tonumber(ARGV[3])
        
        local bucket = redis.call('HMGET', key, 'tokens', 'lastRefill')
        local tokens = tonumber(bucket[1]) or capacity
        local lastRefill = tonumber(bucket[2]) or now
        
        -- Calculate tokens to add based on time elapsed
        local elapsed = (now - lastRefill) / 1000
        local tokensToAdd = math.floor(elapsed * refillRate)
        tokens = math.min(capacity, tokens + tokensToAdd)
        lastRefill = now
        
        -- Check if request is allowed
        local allowed = tokens >= 1
        if allowed then
          tokens = tokens - 1
        end
        
        -- Update bucket
        redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
        redis.call('EXPIRE', key, math.ceil(capacity / refillRate) + 1)
        
        return {allowed and 1 or 0, tokens, capacity}
      `;

      const result = await client.eval(
        luaScript,
        1,
        key,
        capacity.toString(),
        refillRate.toString(),
        now.toString()
      ) as [number, number, number];

      const [allowed, remaining, limit] = result;
      const reset = now + ((capacity - remaining) / refillRate) * 1000;

      return {
        allowed: allowed === 1,
        limit,
        remaining: Math.max(0, Math.floor(remaining)),
        reset,
        retryAfter: allowed === 0 ? Math.ceil((reset - now) / 1000) : undefined,
      };
    });
  }

  private checkLimitMemory(
    key: string,
    now: number,
    capacity: number,
    refillRate: number
  ): RateLimitResult {
    // Store bucket state in memory
    const bucketKey = `token_bucket:${key}`;
    const stored = memoryFallback.get<{ tokens: number; lastRefill: number }>(bucketKey);

    let tokens = stored?.tokens ?? capacity;
    let lastRefill = stored?.lastRefill ?? now;

    // Calculate tokens to add based on time elapsed
    const elapsed = (now - lastRefill) / 1000;
    const tokensToAdd = Math.floor(elapsed * refillRate);
    tokens = Math.min(capacity, tokens + tokensToAdd);
    lastRefill = now;

    // Check if request is allowed
    const allowed = tokens >= 1;
    if (allowed) {
      tokens = tokens - 1;
    }

    // Update bucket
    memoryFallback.set(bucketKey, { tokens, lastRefill }, Math.ceil(capacity / refillRate) + 1);

    const reset = now + ((capacity - tokens) / refillRate) * 1000;

    return {
      allowed,
      limit: capacity,
      remaining: Math.max(0, Math.floor(tokens)),
      reset,
      retryAfter: !allowed ? Math.ceil((reset - now) / 1000) : undefined,
    };
  }

  /**
   * Reset token bucket for an identifier
   */
  async reset(identifier: string, capacity: number): Promise<boolean> {
    const key = createRateLimitKey(identifier, capacity);

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
        logger.warn({ error, identifier }, 'Redis token bucket reset failed, falling back to memory');
      }
    }

    // Fallback to memory
    if (config.fallback.memory) {
      const bucketKey = `token_bucket:${key}`;
      return memoryFallback.delete(bucketKey);
    }

    return false;
  }
}

export const tokenBucketService = new TokenBucketService();

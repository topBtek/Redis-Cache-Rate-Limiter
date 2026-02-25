import { Request, Response, NextFunction } from 'express';
import { rateLimitService } from '../services/rate-limit.service.js';
import { tokenBucketService, type TokenBucketOptions } from '../services/token-bucket.service.js';
import { logger } from '../utils/logger.js';
import type { RateLimitOptions, RateLimitResult } from '../types/index.js';

/**
 * Express middleware for rate limiting
 */
export function rateLimitMiddleware(options: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Generate identifier (IP address by default, or custom key generator)
      const identifier = options.keyGenerator
        ? options.keyGenerator(req)
        : req.ip || req.socket.remoteAddress || 'unknown';

      // Check rate limit
      const result: RateLimitResult = await rateLimitService.checkLimit(identifier, options);

      // Set rate limit headers (RFC 6585)
      res.setHeader('X-RateLimit-Limit', result.limit.toString());
      res.setHeader('X-RateLimit-Remaining', Math.max(0, result.remaining).toString());
      res.setHeader('X-RateLimit-Reset', new Date(result.reset).toISOString());

      if (!result.allowed) {
        // Rate limit exceeded
        if (result.retryAfter) {
          res.setHeader('Retry-After', result.retryAfter.toString());
        }

        // Call onLimitReached callback if provided
        if (options.onLimitReached) {
          options.onLimitReached(identifier, result.limit);
        }

        logger.warn(
          { identifier, limit: result.limit, retryAfter: result.retryAfter },
          'Rate limit exceeded'
        );

        res.status(429).json({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Maximum ${result.limit} requests per ${options.window} seconds.`,
          retryAfter: result.retryAfter,
          limit: result.limit,
          reset: new Date(result.reset).toISOString(),
        });
        return;
      }

      // Attach rate limit info to request for potential use in handlers
      (req as any).rateLimit = result;

      // Continue to next middleware
      next();
    } catch (error) {
      logger.error({ error }, 'Rate limit middleware error');
      // On error, allow the request (fail open)
      next();
    }
  };
}

/**
 * Helper to create rate limit middleware with common configurations
 */
export const rateLimit = {
  /**
   * Per-IP rate limiting
   */
  perIP: (window: number, maxRequests: number, options?: Partial<RateLimitOptions>) =>
    rateLimitMiddleware({
      window,
      maxRequests,
      keyGenerator: (req) => req.ip || req.socket.remoteAddress || 'unknown',
      ...options,
    }),

  /**
   * Per-user rate limiting (requires user ID in request)
   */
  perUser: (window: number, maxRequests: number, options?: Partial<RateLimitOptions>) =>
    rateLimitMiddleware({
      window,
      maxRequests,
      keyGenerator: (req) => {
        const userId = (req as any).user?.id || (req as any).userId || 'anonymous';
        return `user:${userId}`;
      },
      ...options,
    }),

  /**
   * Global rate limiting
   */
  global: (window: number, maxRequests: number, options?: Partial<RateLimitOptions>) =>
    rateLimitMiddleware({
      window,
      maxRequests,
      keyGenerator: () => 'global',
      ...options,
    }),

  /**
   * Custom rate limiting
   */
  custom: (options: RateLimitOptions) => rateLimitMiddleware(options),

  /**
   * Token bucket rate limiting (alternative algorithm)
   * More memory efficient for high-traffic scenarios
   */
  tokenBucket: (
    capacity: number,
    refillRate: number,
    keyGenerator?: (req: Request) => string
  ) => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const identifier = keyGenerator
          ? keyGenerator(req)
          : req.ip || req.socket.remoteAddress || 'unknown';

        const result = await tokenBucketService.checkLimit({
          capacity,
          refillRate,
          identifier,
        });

        // Set rate limit headers
        res.setHeader('X-RateLimit-Limit', result.limit.toString());
        res.setHeader('X-RateLimit-Remaining', Math.max(0, result.remaining).toString());
        res.setHeader('X-RateLimit-Reset', new Date(result.reset).toISOString());

        if (!result.allowed) {
          if (result.retryAfter) {
            res.setHeader('Retry-After', result.retryAfter.toString());
          }

          logger.warn(
            { identifier, limit: result.limit, retryAfter: result.retryAfter },
            'Token bucket rate limit exceeded'
          );

          res.status(429).json({
            error: 'Too Many Requests',
            message: `Rate limit exceeded. Token bucket capacity: ${capacity}, refill rate: ${refillRate}/s.`,
            retryAfter: result.retryAfter,
            limit: result.limit,
            reset: new Date(result.reset).toISOString(),
          });
          return;
        }

        (req as any).rateLimit = result;
        next();
      } catch (error) {
        logger.error({ error }, 'Token bucket middleware error');
        next();
      }
    };
  },
};

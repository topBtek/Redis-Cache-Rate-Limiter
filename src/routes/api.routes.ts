import { Router, Request, Response } from 'express';
import { cacheService } from '../services/cache.service.js';
import { rateLimit } from '../middleware/rate-limit.middleware.js';
import { config } from '../config/index.js';
import { z } from 'zod';

const router = Router();

// Rate limited endpoint - 10 requests per 60 seconds per IP
router.get(
  '/limited',
  rateLimit.perIP(60, 10),
  async (req: Request, res: Response): Promise<void> => {
    const rateLimitInfo = (req as any).rateLimit;
    res.json({
      message: 'This is a rate-limited endpoint',
      rateLimit: {
        limit: rateLimitInfo.limit,
        remaining: rateLimitInfo.remaining,
        reset: new Date(rateLimitInfo.reset).toISOString(),
      },
      timestamp: new Date().toISOString(),
    });
  }
);

// Cache demo endpoint
const cacheDemoSchema = z.object({
  key: z.string().min(1).max(100),
});

router.get('/cache-demo', async (req: Request, res: Response): Promise<void> => {
  try {
    const query = cacheDemoSchema.parse(req.query);
    const { key } = query;

    // Try to get from cache
    let value = await cacheService.get<string>(key);

    if (value === null) {
      // Cache miss - simulate expensive operation
      value = `Cached value for key: ${key} (generated at ${new Date().toISOString()})`;
      
      // Store in cache with 60 second TTL
      await cacheService.set(key, value, { ttl: 60 });
      
      res.json({
        message: 'Cache miss - value generated and cached',
        key,
        value,
        cached: false,
      });
    } else {
      // Cache hit
      res.json({
        message: 'Cache hit - value retrieved from cache',
        key,
        value,
        cached: true,
      });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Validation Error',
        details: error.errors,
      });
      return;
    }
    throw error;
  }
});

// Cache operations endpoint
router.post('/cache', async (req: Request, res: Response): Promise<void> => {
  try {
    const schema = z.object({
      operation: z.enum(['get', 'set', 'delete']),
      key: z.string().min(1).max(100),
      value: z.any().optional(),
      ttl: z.number().positive().optional(),
    });

    const body = schema.parse(req.body);
    const { operation, key, value, ttl } = body;

    switch (operation) {
      case 'get': {
        const cached = await cacheService.get(key);
        res.json({
          success: true,
          key,
          value: cached,
          found: cached !== null,
        });
        break;
      }

      case 'set': {
        if (value === undefined) {
          res.status(400).json({
            error: 'Value is required for set operation',
          });
          return;
        }
        const success = await cacheService.set(key, value, { ttl });
        res.json({
          success,
          key,
          message: success ? 'Value cached successfully' : 'Failed to cache value',
        });
        break;
      }

      case 'delete': {
        const success = await cacheService.delete(key);
        res.json({
          success,
          key,
          message: success ? 'Key deleted successfully' : 'Key not found',
        });
        break;
      }
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Validation Error',
        details: error.errors,
      });
      return;
    }
    throw error;
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { adminAuthMiddleware } from '../middleware/auth.middleware.js';
import { redisService } from '../services/redis.service.js';
import { memoryFallback } from '../services/memory-fallback.service.js';
import { cacheService } from '../services/cache.service.js';
import { config } from '../config/index.js';
import { z } from 'zod';

const router = Router();

// All admin routes require authentication
router.use(adminAuthMiddleware);

// Get cache statistics
router.get('/cache/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const isConnected = redisService.isRedisConnected();
    const fallbackActive = !isConnected && config.fallback.memory;

    let totalKeys = 0;
    let memoryUsed = 'N/A';

    if (isConnected) {
      const keyCount = await redisService.getKeyCount();
      totalKeys = keyCount || 0;

      const info = await redisService.getInfo();
      if (info && info.used_memory_human) {
        memoryUsed = info.used_memory_human;
      }
    } else if (fallbackActive) {
      const stats = memoryFallback.getStats();
      totalKeys = stats.keyCount + stats.rateLimitKeyCount;
      memoryUsed = 'In-memory fallback (no Redis metrics)';
    }

    res.json({
      connected: isConnected,
      fallbackActive,
      totalKeys,
      memoryUsed,
      prefix: config.redis.prefix,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get cache stats',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Flush cache
const flushSchema = z.object({
  prefix: z.string().optional(),
  confirm: z.literal(true),
});

router.post('/cache/flush', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = flushSchema.parse(req.body);

    if (!body.confirm) {
      res.status(400).json({
        error: 'Confirmation required',
        message: 'Set confirm: true in request body to flush cache',
      });
      return;
    }

    const count = await cacheService.flush(body.prefix);

    res.json({
      success: true,
      message: `Flushed ${count} keys`,
      count,
      prefix: body.prefix || config.redis.prefix,
      timestamp: new Date().toISOString(),
    });
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

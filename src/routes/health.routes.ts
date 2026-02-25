import { Router, Request, Response } from 'express';
import { redisService } from '../services/redis.service.js';
import type { HealthCheckResponse } from '../types/index.js';

const router = Router();
const startTime = Date.now();

router.get('/health', async (req: Request, res: Response): Promise<void> => {
  const isConnected = redisService.isRedisConnected();
  
  const response: HealthCheckResponse = {
    status: isConnected ? 'ok' : 'error',
    redis: isConnected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
  };

  res.status(isConnected ? 200 : 503).json(response);
});

export default router;

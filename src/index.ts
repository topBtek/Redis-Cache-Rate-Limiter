import express, { Express } from 'express';
import pinoHttp from 'pino-http';
import { logger } from './utils/logger.js';
import { config } from './config/index.js';
import { errorMiddleware, notFoundMiddleware } from './middleware/error.middleware.js';
import { redisService } from './services/redis.service.js';
import healthRoutes from './routes/health.routes.js';
import apiRoutes from './routes/api.routes.js';
import adminRoutes from './routes/admin.routes.js';

const app: Express = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(pinoHttp({ logger }));

// Request logging
app.use((req, res, next) => {
  logger.debug({ method: req.method, path: req.path, ip: req.ip }, 'Incoming request');
  next();
});

// Routes
app.use('/', healthRoutes);
app.use('/api', apiRoutes);
app.use('/admin', adminRoutes);

// Error handling
app.use(notFoundMiddleware);
app.use(errorMiddleware);

// Graceful shutdown
const server = app.listen(config.server.port, () => {
  logger.info(
    {
      port: config.server.port,
      env: config.server.nodeEnv,
      redisUrl: config.redis.url.replace(/:[^:@]+@/, ':****@'), // Mask password
    },
    'Server started'
  );
});

// Handle graceful shutdown
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutdown signal received');
  
  server.close(async () => {
    logger.info('HTTP server closed');
    
    await redisService.close();
    
    logger.info('Graceful shutdown complete');
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled rejection');
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error({ error }, 'Uncaught exception');
  process.exit(1);
});

export default app;

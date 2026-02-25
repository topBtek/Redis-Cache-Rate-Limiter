import { z } from 'zod';

const configSchema = z.object({
  redis: z.object({
    url: z.string().default('redis://localhost:6379'),
    prefix: z.string().default('cache_rate_limiter'),
  }),
  server: z.object({
    port: z.coerce.number().default(3000),
    nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  }),
  fallback: z.object({
    memory: z.coerce.boolean().default(true),
  }),
  admin: z.object({
    apiKey: z.string().default('change-me-in-production'),
  }),
  logging: z.object({
    level: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  }),
  rateLimit: z.object({
    defaultWindow: z.coerce.number().default(60),
    defaultMaxRequests: z.coerce.number().default(100),
  }),
});

export type Config = z.infer<typeof configSchema>;

export const config: Config = configSchema.parse({
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    prefix: process.env.REDIS_PREFIX || 'cache_rate_limiter',
  },
  server: {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  fallback: {
    memory: process.env.FALLBACK_MEMORY !== 'false',
  },
  admin: {
    apiKey: process.env.ADMIN_API_KEY || 'change-me-in-production',
  },
  logging: {
    level: (process.env.LOG_LEVEL as any) || 'info',
  },
  rateLimit: {
    defaultWindow: process.env.DEFAULT_RATE_LIMIT_WINDOW || 60,
    defaultMaxRequests: process.env.DEFAULT_RATE_LIMIT_MAX_REQUESTS || 100,
  },
});

import Redis, { RedisOptions } from 'ioredis';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

export class RedisService {
  private client: Redis | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    try {
      const options: RedisOptions = {
        retryStrategy: (times: number) => {
          if (times > this.maxReconnectAttempts) {
            logger.error('Max reconnection attempts reached');
            return null; // Stop retrying
          }
          const delay = Math.min(this.reconnectDelay * times, 30000);
          logger.warn({ times, delay }, 'Retrying Redis connection');
          return delay;
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true,
      };

      this.client = new Redis(config.redis.url, options);

      this.client.on('connect', () => {
        logger.info('Redis connecting...');
      });

      this.client.on('ready', () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        logger.info('Redis connected and ready');
      });

      this.client.on('error', (error) => {
        this.isConnected = false;
        logger.error({ error: error.message }, 'Redis error');
      });

      this.client.on('close', () => {
        this.isConnected = false;
        logger.warn('Redis connection closed');
      });

      this.client.on('reconnecting', () => {
        this.reconnectAttempts++;
        logger.info('Redis reconnecting...');
      });

      // Attempt initial connection
      this.client.connect().catch((error) => {
        logger.error({ error: error.message }, 'Failed to connect to Redis');
      });
    } catch (error) {
      logger.error({ error }, 'Failed to initialize Redis client');
      this.client = null;
      this.isConnected = false;
    }
  }

  /**
   * Get Redis client (may be null if not connected)
   */
  getClient(): Redis | null {
    return this.client;
  }

  /**
   * Check if Redis is connected
   */
  isRedisConnected(): boolean {
    return this.isConnected && this.client?.status === 'ready';
  }

  /**
   * Execute a Redis command with error handling
   */
  async execute<T>(command: (client: Redis) => Promise<T>): Promise<T | null> {
    if (!this.isRedisConnected() || !this.client) {
      return null;
    }

    try {
      return await command(this.client);
    } catch (error) {
      logger.error({ error }, 'Redis command failed');
      return null;
    }
  }

  /**
   * Get Redis info
   */
  async getInfo(): Promise<Record<string, string> | null> {
    return this.execute(async (client) => {
      const info = await client.info();
      const parsed: Record<string, string> = {};
      const lines = info.split('\r\n');
      
      for (const line of lines) {
        if (line && !line.startsWith('#') && line.includes(':')) {
          const [key, ...valueParts] = line.split(':');
          parsed[key] = valueParts.join(':');
        }
      }
      
      return parsed;
    });
  }

  /**
   * Get approximate key count (uses DBSIZE)
   */
  async getKeyCount(): Promise<number | null> {
    return this.execute(async (client) => {
      return await client.dbsize();
    });
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
      logger.info('Redis connection closed');
    }
  }
}

export const redisService = new RedisService();

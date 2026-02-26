import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import app from '../src/index.js';
import { redisService } from '../src/services/redis.service.js';
import { config } from '../src/config/index.js';

// Mock Redis service to be disconnected for tests
jest.mock('../src/services/redis.service.js', () => ({
  redisService: {
    isRedisConnected: jest.fn().mockReturnValue(false),
    getKeyCount: jest.fn().mockResolvedValue(0),
    getInfo: jest.fn().mockResolvedValue({ used_memory_human: '1M' }),
    close: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('API Endpoints', () => {
  beforeAll(() => {
    // Set test environment
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_API_KEY = 'test-admin-key';
  });

  afterAll(async () => {
    // Cleanup
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/health');
      
      expect(response.status).toBe(503); // Redis disconnected
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('redis');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
    });
  });

  describe('GET /api/limited', () => {
    it('should apply rate limiting', async () => {
      // Make requests up to the limit
      for (let i = 0; i < 10; i++) {
        const response = await request(app).get('/api/limited');
        expect(response.status).toBe(200);
        expect(response.headers['x-ratelimit-limit']).toBe('10');
      }

      // 11th request should be rate limited
      const response = await request(app).get('/api/limited');
      expect(response.status).toBe(429);
      expect(response.headers['retry-after']).toBeDefined();
      expect(response.body).toHaveProperty('error', 'Too Many Requests');
    });

    it('should include rate limit headers', async () => {
      const response = await request(app).get('/api/limited');
      
      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
    });
  });

  describe('GET /api/cache-demo', () => {
    it('should return cache miss on first request', async () => {
      const response = await request(app)
        .get('/api/cache-demo')
        .query({ key: 'test-key-1' });

      expect(response.status).toBe(200);
      expect(response.body.cached).toBe(false);
      expect(response.body).toHaveProperty('value');
    });

    it('should return cache hit on second request', async () => {
      const key = 'test-key-2';
      
      // First request
      await request(app).get('/api/cache-demo').query({ key });
      
      // Second request
      const response = await request(app)
        .get('/api/cache-demo')
        .query({ key });

      expect(response.status).toBe(200);
      expect(response.body.cached).toBe(true);
    });

    it('should validate query parameters', async () => {
      const response = await request(app).get('/api/cache-demo');
      
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('POST /api/cache', () => {
    it('should set cache value', async () => {
      const response = await request(app)
        .post('/api/cache')
        .send({
          operation: 'set',
          key: 'test-set-key',
          value: { foo: 'bar' },
          ttl: 60,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should get cache value', async () => {
      const key = 'test-get-key';
      
      // Set first
      await request(app)
        .post('/api/cache')
        .send({
          operation: 'set',
          key,
          value: 'test-value',
        });

      // Get
      const response = await request(app)
        .post('/api/cache')
        .send({
          operation: 'get',
          key,
        });

      expect(response.status).toBe(200);
      expect(response.body.found).toBe(true);
      expect(response.body.value).toBe('test-value');
    });

    it('should delete cache value', async () => {
      const key = 'test-delete-key';
      
      // Set first
      await request(app)
        .post('/api/cache')
        .send({
          operation: 'set',
          key,
          value: 'test-value',
        });

      // Delete
      const response = await request(app)
        .post('/api/cache')
        .send({
          operation: 'delete',
          key,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /admin/cache/stats', () => {
    it('should require authentication', async () => {
      const response = await request(app).get('/admin/cache/stats');
      
      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Unauthorized');
    });

    it('should return stats with valid API key', async () => {
      const response = await request(app)
        .get('/admin/cache/stats')
        .set('x-api-key', 'test-admin-key');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('connected');
      expect(response.body).toHaveProperty('totalKeys');
      expect(response.body).toHaveProperty('memoryUsed');
    });
  });

  describe('POST /admin/cache/flush', () => {
    it('should require authentication', async () => {
      const response = await request(app)
        .post('/admin/cache/flush')
        .send({ confirm: true });

      expect(response.status).toBe(401);
    });

    it('should require confirmation', async () => {
      const response = await request(app)
        .post('/admin/cache/flush')
        .set('x-api-key', 'test-admin-key')
        .send({});

      expect(response.status).toBe(400);
    });

    it('should flush cache with valid credentials and confirmation', async () => {
      const response = await request(app)
        .post('/admin/cache/flush')
        .set('x-api-key', 'test-admin-key')
        .send({ confirm: true });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('count');
    });
  });

  describe('404 Handler', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app).get('/unknown-route');
      
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Not Found');
    });
  });
});

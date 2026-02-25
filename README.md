# Redis Cache & Rate Limiter – Upstash-inspired Self-hosted Service

A production-ready Node.js + TypeScript backend service that implements high-performance Redis-based caching and distributed rate limiting, inspired by Upstash's serverless Redis architecture but designed for self-hosted deployments. This service provides a robust, scalable solution for caching data and enforcing rate limits across distributed systems with automatic fallback to in-memory storage when Redis is unavailable.

## Features

### 🚀 Core Capabilities

- **General-Purpose Caching Layer**
  - Get/set/delete operations with TTL support
  - Cache-aside pattern helpers (`cache.wrap`, `cache.getOrSet`)
  - Automatic JSON serialization/deserialization
  - Configurable per-key caching strategies

- **Distributed Rate Limiting**
  - Sliding window log algorithm (highly accurate)
  - Per-IP, per-user, and global rate limiting
  - Configurable limits per route/key
  - Standard RFC 6585 rate limit headers (`X-RateLimit-*`, `Retry-After`)

- **Resilience & Reliability**
  - Automatic in-memory fallback when Redis is unavailable
  - Graceful degradation without service interruption
  - Redis connection retry and reconnection logic
  - Comprehensive error handling

- **Developer Experience**
  - Express.js middleware for easy route protection
  - Strong TypeScript typing throughout
  - Structured logging with Pino
  - Input validation with Zod
  - Comprehensive test coverage

- **Security**
  - Key sanitization to prevent injection attacks
  - Admin endpoints protected with API key authentication
  - Configurable Redis key prefixing
  - Protection against key enumeration

## Tech Stack

- **Runtime**: Node.js 20+ (ESM)
- **Language**: TypeScript 5.3+
- **Framework**: Express.js 4.18+
- **Redis Client**: ioredis 5.3+
- **Validation**: Zod 3.22+
- **Logging**: Pino 8.16+
- **Testing**: Jest 29.7+ with Supertest
- **Build Tool**: tsx (development), tsc (production)

## Prerequisites

- **Node.js**: Version 20.0.0 or higher
- **Redis**: A running Redis instance (local or remote)
  - Redis 6.0+ recommended
  - Supports both standard and TLS connections

## Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd Redis-Cache-Rate-Limiter-1
npm install
```

### 2. Configure Environment

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

Edit `.env` and set your Redis connection:

```env
REDIS_URL=redis://localhost:6379
# Or for TLS: REDIS_URL=rediss://user:password@host:port

REDIS_PREFIX=cache_rate_limiter
FALLBACK_MEMORY=true
PORT=3000
ADMIN_API_KEY=your-secure-api-key-here
```

### 3. Start Redis (if running locally)

```bash
# Using Docker
docker run -d -p 6379:6379 redis:7-alpine

# Or using local Redis installation
redis-server
```

### 4. Run the Service

```bash
# Development mode (with hot reload)
npm run dev

# Production mode
npm run build
npm start
```

The service will start on `http://localhost:3000` (or your configured PORT).

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_URL` | Redis connection URL (supports `redis://` and `rediss://` for TLS) | `redis://localhost:6379` |
| `REDIS_PREFIX` | Prefix for all Redis keys | `cache_rate_limiter` |
| `FALLBACK_MEMORY` | Enable in-memory fallback when Redis is down | `true` |
| `PORT` | HTTP server port | `3000` |
| `NODE_ENV` | Environment (development/production/test) | `development` |
| `ADMIN_API_KEY` | API key for admin endpoints | `change-me-in-production` |
| `LOG_LEVEL` | Logging level (fatal/error/warn/info/debug/trace) | `info` |
| `DEFAULT_RATE_LIMIT_WINDOW` | Default rate limit window in seconds | `60` |
| `DEFAULT_RATE_LIMIT_MAX_REQUESTS` | Default max requests per window | `100` |

## Usage Examples

### Rate Limiting Middleware

#### Per-IP Rate Limiting

```typescript
import { rateLimit } from './middleware/rate-limit.middleware.js';
import express from 'express';

const app = express();

// 100 requests per 60 seconds per IP
app.get('/api/users', rateLimit.perIP(60, 100), (req, res) => {
  res.json({ users: [] });
});
```

#### Per-User Rate Limiting

```typescript
// 500 requests per hour per user
app.post('/api/posts', rateLimit.perUser(3600, 500), (req, res) => {
  res.json({ success: true });
});
```

#### Global Rate Limiting

```typescript
// 1000 requests per minute globally
app.get('/api/public', rateLimit.global(60, 1000), (req, res) => {
  res.json({ data: 'public' });
});
```

#### Custom Rate Limiting

```typescript
app.post('/api/custom', rateLimit.custom({
  window: 300, // 5 minutes
  maxRequests: 50,
  keyGenerator: (req) => `custom:${req.headers['x-custom-id']}`,
  onLimitReached: (key, limit) => {
    console.log(`Rate limit reached for ${key}: ${limit}`);
  },
}), (req, res) => {
  res.json({ success: true });
});
```

### Caching Service

#### Basic Cache Operations

```typescript
import { cacheService } from './services/cache.service.js';

// Set a value with TTL
await cacheService.set('user:123', { name: 'John', email: 'john@example.com' }, {
  ttl: 3600, // 1 hour
});

// Get a value
const user = await cacheService.get<{ name: string; email: string }>('user:123');

// Delete a value
await cacheService.delete('user:123');
```

#### Cache-Aside Pattern

```typescript
// Using getOrSet
const user = await cacheService.getOrSet(
  'user:123',
  async () => {
    // This function is only called on cache miss
    return await db.getUser(123);
  },
  { ttl: 3600 }
);

// Using wrap (same as getOrSet)
const posts = await cacheService.wrap(
  'posts:recent',
  async () => await db.getRecentPosts(),
  { ttl: 300 }
);
```

#### In a Route Handler

```typescript
app.get('/api/user/:id', async (req, res) => {
  const userId = req.params.id;
  
  const user = await cacheService.getOrSet(
    `user:${userId}`,
    async () => {
      // Fetch from database
      return await database.findUser(userId);
    },
    { ttl: 1800 } // 30 minutes
  );
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  res.json(user);
});
```

## API Endpoints

### Health Check

**GET** `/health`

Returns the health status of the service and Redis connection.

**Response:**
```json
{
  "status": "ok",
  "redis": "connected",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600
}
```

**Status Codes:**
- `200`: Service healthy, Redis connected
- `503`: Service degraded, Redis disconnected

---

### Rate Limit Test

**GET** `/api/limited`

Demonstrates rate limiting (10 requests per 60 seconds per IP).

**Response Headers:**
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Remaining requests in window
- `X-RateLimit-Reset`: ISO timestamp when limit resets

**Response (200 OK):**
```json
{
  "message": "This is a rate-limited endpoint",
  "rateLimit": {
    "limit": 10,
    "remaining": 5,
    "reset": "2024-01-15T10:31:00.000Z"
  },
  "timestamp": "2024-01-15T10:30:30.000Z"
}
```

**Response (429 Too Many Requests):**
```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Maximum 10 requests per 60 seconds.",
  "retryAfter": 30,
  "limit": 10,
  "reset": "2024-01-15T10:31:00.000Z"
}
```

---

### Cache Demo

**GET** `/api/cache-demo?key=<key>`

Demonstrates caching with a simple key-value example.

**Query Parameters:**
- `key` (required): Cache key to use

**Response (Cache Miss):**
```json
{
  "message": "Cache miss - value generated and cached",
  "key": "example",
  "value": "Cached value for key: example (generated at 2024-01-15T10:30:00.000Z)",
  "cached": false
}
```

**Response (Cache Hit):**
```json
{
  "message": "Cache hit - value retrieved from cache",
  "key": "example",
  "value": "Cached value for key: example (generated at 2024-01-15T10:30:00.000Z)",
  "cached": true
}
```

---

### Cache Operations

**POST** `/api/cache`

Programmatic cache operations.

**Request Body:**
```json
{
  "operation": "get|set|delete",
  "key": "cache-key",
  "value": "any-value", // Required for 'set'
  "ttl": 3600 // Optional, for 'set' operation
}
```

**Response (Get):**
```json
{
  "success": true,
  "key": "cache-key",
  "value": "cached-value",
  "found": true
}
```

**Response (Set):**
```json
{
  "success": true,
  "key": "cache-key",
  "message": "Value cached successfully"
}
```

---

### Admin: Cache Statistics

**GET** `/admin/cache/stats`

Returns Redis and cache statistics. **Requires authentication.**

**Headers:**
- `X-API-Key`: Admin API key (or `?apiKey=...` query parameter)

**Response:**
```json
{
  "connected": true,
  "fallbackActive": false,
  "totalKeys": 1250,
  "memoryUsed": "2.5M",
  "prefix": "cache_rate_limiter",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

### Admin: Flush Cache

**POST** `/admin/cache/flush`

Flushes all cache keys (or keys with a specific prefix). **Requires authentication.**

**Headers:**
- `X-API-Key`: Admin API key

**Request Body:**
```json
{
  "confirm": true, // Required: must be true
  "prefix": "optional-prefix" // Optional: flush only keys with this prefix
}
```

**Response:**
```json
{
  "success": true,
  "message": "Flushed 1250 keys",
  "count": 1250,
  "prefix": "cache_rate_limiter",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Rate Limit Response Format

When a rate limit is exceeded, the service returns a `429 Too Many Requests` response with:

- **Status Code**: `429`
- **Headers**:
  - `X-RateLimit-Limit`: Maximum requests allowed
  - `X-RateLimit-Remaining`: `0`
  - `X-RateLimit-Reset`: ISO timestamp when limit resets
  - `Retry-After`: Seconds until retry is allowed
- **Body**: JSON error object with details

## Testing

Run the test suite:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Test Coverage

The test suite covers:
- ✅ Cache service operations (get/set/delete/getOrSet/wrap)
- ✅ Rate limiting logic (sliding window, limit enforcement, reset)
- ✅ API endpoints (health, rate limiting, caching, admin)
- ✅ Key utilities and sanitization
- ✅ Redis fallback behavior
- ✅ Error handling

## Project Structure

```
.
├── src/
│   ├── config/           # Configuration management
│   ├── middleware/        # Express middleware (rate limit, auth, error)
│   ├── routes/            # API route handlers
│   ├── services/          # Core services (Redis, cache, rate limit, memory fallback)
│   ├── types/             # TypeScript type definitions
│   ├── utils/             # Utility functions (logger, key utils)
│   └── index.ts           # Application entry point
├── tests/                 # Test files
├── dist/                  # Compiled JavaScript (generated)
├── package.json
├── tsconfig.json
├── jest.config.js
└── README.md
```

## Security & Production Notes

### Redis Security

- **TLS/SSL**: Use `rediss://` URL scheme for encrypted connections
- **Authentication**: Include credentials in Redis URL: `redis://user:password@host:port`
- **Network**: Restrict Redis access to trusted networks/firewalls
- **Key Prefixing**: Use `REDIS_PREFIX` to namespace keys and prevent collisions

### API Security

- **Admin Endpoints**: Always use a strong `ADMIN_API_KEY` in production
- **Rate Limiting**: Apply rate limits to all public endpoints
- **Input Validation**: All inputs are validated with Zod schemas
- **Key Sanitization**: Keys are sanitized to prevent injection attacks

### Production Deployment

1. **Environment Variables**: Never commit `.env` files
2. **Logging**: Use structured logging (Pino) for production monitoring
3. **Monitoring**: Monitor Redis connection status and fallback usage
4. **Scaling**: This service is stateless and can be horizontally scaled
5. **Redis**: Use a managed Redis service (AWS ElastiCache, Redis Cloud, etc.) for production

## Deployment

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Railway

1. Connect your GitHub repository
2. Set environment variables in Railway dashboard
3. Deploy (Railway auto-detects Node.js)

### Fly.io

```bash
fly launch
# Set REDIS_URL and other env vars
fly secrets set REDIS_URL=redis://...
fly deploy
```

### Vercel / Serverless

**Note**: For serverless deployments, ensure Redis connection pooling is configured correctly. Consider using Upstash Redis for serverless-friendly Redis.

## Why This Project?

This project demonstrates senior-level backend engineering skills:

1. **Distributed Systems**: Understanding of distributed rate limiting and caching patterns
2. **Resilience**: Graceful degradation and fallback strategies
3. **Type Safety**: Strong TypeScript typing throughout
4. **Testing**: Comprehensive test coverage with Jest
5. **Production Readiness**: Error handling, logging, monitoring, security considerations
6. **Architecture**: Clean, modular, scalable code structure
7. **Best Practices**: Follows 2026 Node.js/TypeScript best practices

Perfect for:
- Senior backend developer portfolios
- System design interviews
- Production microservices
- Learning distributed systems patterns

## Support

- telegram: https://t.me/topBtek
- twitter:  https://x.com/topBtek

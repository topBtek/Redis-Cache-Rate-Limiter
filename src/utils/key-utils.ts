import { config } from '../config/index.js';

/**
 * Sanitizes a key to prevent injection attacks
 */
export function sanitizeKey(key: string): string {
  // Remove any characters that could be used for injection
  // Allow alphanumeric, hyphens, underscores, colons, and dots
  return key.replace(/[^a-zA-Z0-9\-_:.]/g, '_');
}

/**
 * Creates a prefixed Redis key
 */
export function createKey(parts: string[]): string {
  const sanitized = parts.map(sanitizeKey).filter(Boolean);
  return `${config.redis.prefix}:${sanitized.join(':')}`;
}

/**
 * Creates a cache key
 */
export function createCacheKey(key: string): string {
  return createKey(['cache', key]);
}

/**
 * Creates a rate limit key
 */
export function createRateLimitKey(identifier: string, window: number): string {
  return createKey(['ratelimit', identifier, `w${window}`]);
}

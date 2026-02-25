import { logger } from '../utils/logger.js';

interface MemoryEntry<T> {
  value: T;
  expiresAt: number | null;
}

/**
 * In-memory fallback storage when Redis is unavailable
 */
export class MemoryFallbackService {
  private store: Map<string, MemoryEntry<any>> = new Map();
  private rateLimitStore: Map<string, number[]> = new Map();

  /**
   * Get value from memory cache
   */
  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }

    // Check expiration
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry.value as T;
  }

  /**
   * Set value in memory cache
   */
  set<T>(key: string, value: T, ttl?: number): void {
    const expiresAt = ttl ? Date.now() + ttl * 1000 : null;
    this.store.set(key, { value, expiresAt });
  }

  /**
   * Delete value from memory cache
   */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /**
   * Clear all keys with a prefix
   */
  clearPrefix(prefix: string): number {
    let count = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        count++;
      }
    }
    for (const key of this.rateLimitStore.keys()) {
      if (key.startsWith(prefix)) {
        this.rateLimitStore.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.store.clear();
    this.rateLimitStore.clear();
  }

  /**
   * Get rate limit timestamps for a key
   */
  getRateLimitTimestamps(key: string): number[] {
    const timestamps = this.rateLimitStore.get(key) || [];
    // Clean up expired timestamps
    const now = Date.now();
    const valid = timestamps.filter((ts) => ts > now);
    if (valid.length !== timestamps.length) {
      this.rateLimitStore.set(key, valid);
    }
    return valid;
  }

  /**
   * Add a rate limit timestamp
   */
  addRateLimitTimestamp(key: string, timestamp: number, windowSeconds: number): void {
    const timestamps = this.getRateLimitTimestamps(key);
    const windowMs = windowSeconds * 1000;
    const cutoff = Date.now() - windowMs;
    
    // Filter out old timestamps
    const valid = timestamps.filter((ts) => ts > cutoff);
    valid.push(timestamp);
    
    this.rateLimitStore.set(key, valid);
  }

  /**
   * Get memory stats
   */
  getStats(): { keyCount: number; rateLimitKeyCount: number } {
    return {
      keyCount: this.store.size,
      rateLimitKeyCount: this.rateLimitStore.size,
    };
  }
}

export const memoryFallback = new MemoryFallbackService();

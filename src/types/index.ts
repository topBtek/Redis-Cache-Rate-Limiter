export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  serialize?: boolean; // Auto JSON serialize/deserialize (default: true)
}

export interface RateLimitOptions {
  window: number; // Time window in seconds
  maxRequests: number; // Maximum requests per window
  keyGenerator?: (req: any) => string; // Custom key generator function
  skipSuccessfulRequests?: boolean; // Don't count successful requests
  skipFailedRequests?: boolean; // Don't count failed requests
  onLimitReached?: (key: string, limit: number) => void; // Callback when limit is reached
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp when the limit resets
  retryAfter?: number; // Seconds until retry is allowed
}

export interface CacheStats {
  totalKeys: number;
  memoryUsed: string;
  connected: boolean;
  fallbackActive: boolean;
}

export interface HealthCheckResponse {
  status: 'ok' | 'error';
  redis: 'connected' | 'disconnected';
  timestamp: string;
  uptime: number;
}

import { logger } from './logger.js';

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

export class RateLimiter {
  private buckets: Map<string, TokenBucket>;
  private readonly maxTokens: number;
  private readonly refillRate: number;
  private readonly windowMs: number;

  constructor(
    maxRequests = 60,
    windowMs = 60000,
    private readonly keyPrefix = ''
  ) {
    this.maxTokens = maxRequests;
    this.refillRate = maxRequests / (windowMs / 1000); // tokens per second
    this.windowMs = windowMs;
    this.buckets = new Map();

    // Periodically clean up expired buckets
    setInterval(() => this.cleanupBuckets(), windowMs);
  }

  public acquire(key: string): boolean {
    const bucketKey = this.keyPrefix ? `${this.keyPrefix}:${key}` : key;
    const now = Date.now();

    // Get or create bucket
    let bucket = this.buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        tokens: this.maxTokens,
        lastRefill: now,
      };
      this.buckets.set(bucketKey, bucket);
    }

    // Refill tokens based on time elapsed
    const timePassed = now - bucket.lastRefill;
    const tokensToAdd = timePassed * (this.refillRate / 1000);
    bucket.tokens = Math.min(this.maxTokens, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    // Check if we can consume a token
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    logger.warn('Rate limit exceeded', {
      key: bucketKey,
      remainingTime: this.getRemainingTime(bucket),
    });

    return false;
  }

  public async acquireStrict(key: string): Promise<void> {
    await Promise.resolve(); // Make this truly async
    const acquired = this.acquire(key);
    if (!acquired) {
      throw new Error('Rate limit exceeded');
    }
  }

  public getRemainingTokens(key: string): number {
    const bucket = this.buckets.get(key);
    return bucket ? Math.floor(bucket.tokens) : this.maxTokens;
  }

  private getRemainingTime(bucket: TokenBucket): number {
    if (bucket.tokens >= 1) {
      return 0;
    }
    return Math.ceil((1 - bucket.tokens) / this.refillRate * 1000);
  }

  private cleanupBuckets(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets.entries()) {
      if (now - bucket.lastRefill > this.windowMs) {
        this.buckets.delete(key);
      }
    }
  }

  public getStats(): { totalBuckets: number; maxTokens: number; windowMs: number; refillRate: number } {
    return {
      totalBuckets: this.buckets.size,
      maxTokens: this.maxTokens,
      windowMs: this.windowMs,
      refillRate: this.refillRate,
    };
  }
}

// Create singleton instances for different services
export const searchRateLimiter = new RateLimiter(
  parseInt(process.env['RATE_LIMIT_MAX_REQUESTS'] || '60', 10),
  parseInt(process.env['RATE_LIMIT_WINDOW'] || '60000', 10),
  'search'
);

export const extractionRateLimiter = new RateLimiter(
  parseInt(process.env['RATE_LIMIT_MAX_REQUESTS'] || '60', 10),
  parseInt(process.env['RATE_LIMIT_WINDOW'] || '60000', 10),
  'extraction'
);
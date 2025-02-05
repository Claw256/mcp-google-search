import NodeCache from 'node-cache';
import { logger } from './logger.js';

interface CacheConfig {
  ttl: number;
  checkPeriod: number;
  maxKeys: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  keys: number;
  ksize: number;
  vsize: number;
}

export class CacheManager {
  private cache: NodeCache;
  private readonly config: CacheConfig;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      ttl: config.ttl || 3600, // 1 hour
      checkPeriod: config.checkPeriod || 600, // 10 minutes
      maxKeys: config.maxKeys || 1000,
    };

    this.cache = new NodeCache({
      stdTTL: this.config.ttl,
      checkperiod: this.config.checkPeriod,
      maxKeys: this.config.maxKeys,
    });

    this.setupListeners();
  }

  private setupListeners(): void {
    this.cache.on('expired', (_key: string) => {
      logger.debug('Cache item expired');
    });

    this.cache.on('flush', () => {
      logger.debug('Cache flushed');
    });

    this.cache.on('set', (_key: string) => {
      const stats = this.cache.getStats();
      if (stats.keys >= this.config.maxKeys * 0.9) {
        logger.warn('Cache capacity at 90%', {
          keys: stats.keys,
          maxKeys: this.config.maxKeys,
        });
      }
    });
  }

  public get<T>(key: string): T | undefined {
    const value = this.cache.get<T>(key);
    logger.debug(value ? 'Cache hit' : 'Cache miss', { key });
    return value;
  }

  public set<T>(key: string, value: T, ttl?: number): boolean {
    const success = this.cache.set(key, value, ttl || this.config.ttl);
    if (!success) {
      logger.error('Failed to set cache key', { key });
    }
    return success;
  }

  public del(key: string): void {
    this.cache.del(key);
  }

  public flush(): void {
    this.cache.flushAll();
  }

  public getStats(): CacheStats {
    return this.cache.getStats();
  }
}

// Create and export singleton instances for different services
export const searchCache = new CacheManager({
  ttl: 3600, // 1 hour
  maxKeys: 1000,
});

export const viewUrlCache = new CacheManager({
  ttl: 7200, // 2 hours
  maxKeys: 500,
});
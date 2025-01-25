import NodeCache from 'node-cache';
import { logger } from './logger.js';
export class CacheManager {
    cache;
    config;
    constructor(config = {}) {
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
    setupListeners() {
        this.cache.on('expired', (_key) => {
            logger.debug('Cache item expired');
        });
        this.cache.on('flush', () => {
            logger.debug('Cache flushed');
        });
        this.cache.on('set', (_key) => {
            const stats = this.cache.getStats();
            if (stats.keys >= this.config.maxKeys * 0.9) {
                logger.warn('Cache capacity at 90%', {
                    keys: stats.keys,
                    maxKeys: this.config.maxKeys,
                });
            }
        });
    }
    get(key) {
        const value = this.cache.get(key);
        logger.debug(value ? 'Cache hit' : 'Cache miss', { key });
        return value;
    }
    set(key, value, ttl) {
        const success = this.cache.set(key, value, ttl || this.config.ttl);
        if (!success) {
            logger.error('Failed to set cache key', { key });
        }
        return success;
    }
    del(key) {
        this.cache.del(key);
    }
    flush() {
        this.cache.flushAll();
    }
    getStats() {
        return this.cache.getStats();
    }
}
// Create and export singleton instances for different services
export const searchCache = new CacheManager({
    ttl: 3600, // 1 hour
    maxKeys: 1000,
});
export const extractionCache = new CacheManager({
    ttl: 7200, // 2 hours
    maxKeys: 500,
});

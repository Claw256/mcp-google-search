import { google } from 'googleapis';
import { SearchError } from '../types';
import { logger } from '../infrastructure/logger';
import { searchCache } from '../infrastructure/cache-manager';
import { searchRateLimiter } from '../infrastructure/rate-limiter';
class SearchService {
    customSearch;
    constructor() {
        const apiKey = process.env['GOOGLE_API_KEY'];
        const searchEngineId = process.env['GOOGLE_SEARCH_ENGINE_ID'];
        if (!apiKey || !searchEngineId) {
            throw new Error('Missing required Google API configuration');
        }
        this.customSearch = google.customsearch('v1').cse;
    }
    async search(params) {
        const cacheKey = JSON.stringify(params);
        const cachedResults = searchCache.get(cacheKey);
        if (cachedResults) {
            logger.debug('Returning cached search results', { query: params.query });
            return cachedResults;
        }
        // Check rate limit
        const canProceed = searchRateLimiter.acquire(params.query);
        if (!canProceed) {
            const error = new SearchError('Search rate limit exceeded', 'RATE_LIMIT_ERROR', 429);
            logger.error('Rate limit exceeded', {
                query: params.query,
                error: error.message,
                code: error.code,
            });
            throw error;
        }
        try {
            const searchOptions = this.buildSearchOptions(params);
            const response = await this.customSearch.list(searchOptions);
            const data = response.data;
            if (!data.items) {
                logger.debug('No search results found', { query: params.query });
                return [];
            }
            const results = this.processSearchResults(data.items);
            searchCache.set(cacheKey, results);
            logger.debug('Search completed successfully', {
                query: params.query,
                resultCount: results.length,
            });
            return results;
        }
        catch (error) {
            const formattedError = error instanceof Error ? {
                message: error.message,
                name: error.name,
                stack: error.stack,
            } : { message: String(error) };
            logger.error('Search error:', {
                query: params.query,
                error: formattedError,
            });
            throw new SearchError(error instanceof Error ? error.message : 'Unknown search error');
        }
    }
    buildSearchOptions(params) {
        const options = {
            q: params.query,
            cx: process.env['GOOGLE_SEARCH_ENGINE_ID'],
            auth: process.env['GOOGLE_API_KEY'],
            num: params.resultCount || 10,
        };
        if (params.safeSearch) {
            options['safe'] = 'active';
        }
        if (params.dateRestrict) {
            options['dateRestrict'] = params.dateRestrict;
        }
        // Build site filtering
        const siteFilters = [];
        if (params.trustedDomains?.length) {
            siteFilters.push(...params.trustedDomains.map(domain => `site:${domain}`));
        }
        if (params.excludedDomains?.length) {
            siteFilters.push(...params.excludedDomains.map(domain => `-site:${domain}`));
        }
        if (siteFilters.length > 0) {
            options['q'] = `${options['q']} ${siteFilters.join(' ')}`;
        }
        return options;
    }
    processSearchResults(items) {
        return items.map(item => ({
            title: item.title || '',
            link: item.link || '',
            snippet: item.snippet || '',
            datePublished: item.pagemap?.metatags?.[0]?.['article:published_time'],
            imageUrl: item.pagemap?.cse_image?.[0]?.src,
        }));
    }
    validateParams(params) {
        if (!params.query) {
            throw new SearchError('Search query is required');
        }
        if (params.resultCount && (params.resultCount < 1 || params.resultCount > 10)) {
            throw new SearchError('Result count must be between 1 and 10');
        }
        if (params.dateRestrict && !params.dateRestrict.match(/^[dmy][1-9][0-9]*$/)) {
            throw new SearchError('Invalid date restriction format. Use d[number], m[number], or y[number]');
        }
        // Validate domain formats
        const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/;
        if (params.trustedDomains?.some(domain => !domainRegex.test(domain))) {
            throw new SearchError('Invalid trusted domain format');
        }
        if (params.excludedDomains?.some(domain => !domainRegex.test(domain))) {
            throw new SearchError('Invalid excluded domain format');
        }
    }
}
export const searchService = new SearchService();

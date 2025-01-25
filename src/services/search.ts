import { google } from 'googleapis';
import type { customsearch_v1 } from 'googleapis';
import type { SearchParams, SearchResult } from '../types';
import { SearchError } from '../types';
import { logger } from '../infrastructure/logger';
import { searchCache } from '../infrastructure/cache-manager';
import { searchRateLimiter } from '../infrastructure/rate-limiter';

interface GoogleSearchResult extends customsearch_v1.Schema$Result {
  pagemap?: {
    metatags?: Array<{
      'article:published_time'?: string;
    }>;
    cse_image?: Array<{
      src?: string;
    }>;
  };
  title?: string;
  link?: string;
  snippet?: string;
}

type GoogleSearchResponse = {
  items?: GoogleSearchResult[];
};

class SearchService {
  private baseUrl = 'https://www.googleapis.com/customsearch/v1';
  private customSearch;

  constructor() {
    const apiKey = process.env['GOOGLE_API_KEY'];
    const searchEngineId = process.env['GOOGLE_SEARCH_ENGINE_ID'];

    if (!apiKey || !searchEngineId) {
      throw new Error('Missing required Google API configuration');
    }

    this.customSearch = google.customsearch('v1').cse;
  }

  public async search(params: SearchParams): Promise<SearchResult[]> {
    // Validate parameters first
    this.validateParams(params);

    const cacheKey = JSON.stringify(params);
    const cachedResults = searchCache.get<SearchResult[]>(cacheKey);

    if (cachedResults) {
      logger.debug('Returning cached search results', { query: params.query });
      return cachedResults;
    }

    // Check rate limit
    const canProceed = searchRateLimiter.acquire(params.query);
    if (!canProceed) {
      const error = new SearchError(
        'Search rate limit exceeded',
        'RATE_LIMIT_ERROR',
        429
      );
      logger.error('Rate limit exceeded', {
        query: params.query,
        error: error.message,
        code: error.code,
      });
      throw error;
    }

    try {
      const searchOptions = this.buildSearchOptions(params);
      logger.info('Executing search with options:', searchOptions);
      
      const response = await this.customSearch.list({
        q: params.query,
        cx: process.env['GOOGLE_SEARCH_ENGINE_ID'],
        key: process.env['GOOGLE_API_KEY'],
        num: params.resultCount || 10,
        ...(params.safeSearch && { safe: 'active' }),
        ...(params.dateRestrict && { dateRestrict: params.dateRestrict }),
        ...(params.trustedDomains?.length === 1 && {
          siteSearch: params.trustedDomains[0],
          siteSearchFilter: 'i'
        }),
        ...(params.excludedDomains?.length === 1 && {
          siteSearch: params.excludedDomains[0],
          siteSearchFilter: 'e'
        }),
        // Request longer snippets
        c2coff: '0', // Enable all content features
        filter: '0',  // Turn off duplicate content filter
        // Request full text snippets
        orTerms: params.query, // Also match similar terms
        exactTerms: '', // Don't require exact matches
        // Additional parameters to improve snippet quality
        lr: 'lang_en', // English results
        hl: 'en',      // English interface
      });

      const data = response.data as GoogleSearchResponse;

      logger.info('Search response:', {
        itemCount: data.items?.length || 0,
        query: params.query
      });

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
    } catch (error) {
      const formattedError = error instanceof Error ? {
        message: error.message,
        name: error.name,
        stack: error.stack,
      } : { message: String(error) };

      logger.error('Search error:', {
        query: params.query,
        error: formattedError,
      });

      throw new SearchError(
        error instanceof Error ? error.message : 'Unknown search error'
      );
    }
  }

  private buildSearchOptions(params: SearchParams): Record<string, unknown> {
    // Start with required parameters
    const options: Record<string, unknown> = {
      q: params.query,
      cx: process.env['GOOGLE_SEARCH_ENGINE_ID'],
      key: process.env['GOOGLE_API_KEY'],
      num: params.resultCount || 10,
      // Request longer snippets
      c2coff: '0', // Enable all content features
      filter: '0',  // Turn off duplicate content filter
      // Request full text snippets
      orTerms: params.query, // Also match similar terms
      exactTerms: '', // Don't require exact matches
      // Additional parameters to improve snippet quality
      lr: 'lang_en', // English results
      hl: 'en',      // English interface
    };

    // Add optional parameters
    if (params.safeSearch) {
      options['safe'] = 'active';
    }

    if (params.dateRestrict) {
      options['dateRestrict'] = params.dateRestrict;
    }

    // Handle trusted domains
    const trustedDomains = params.trustedDomains || [];
    if (trustedDomains.length === 1) {
      options['siteSearch'] = trustedDomains[0];
      options['siteSearchFilter'] = 'i'; // include results from this site
    } else if (trustedDomains.length > 1) {
      // For multiple trusted domains, we need to use OR in the query
      const trustedSites = trustedDomains
        .map(domain => `site:${domain}`)
        .join(' OR ');
      options['q'] = `${options['q']} (${trustedSites})`;
    }

    // Handle excluded domains
    const excludedDomains = params.excludedDomains || [];
    if (excludedDomains.length === 1) {
      options['siteSearch'] = excludedDomains[0];
      options['siteSearchFilter'] = 'e'; // exclude results from this site
    } else if (excludedDomains.length > 1) {
      // For multiple excluded domains, we need to use multiple -site: operators
      const excludedSites = excludedDomains
        .map(domain => `-site:${domain}`)
        .join(' ');
      options['q'] = `${options['q']} ${excludedSites}`;
    }

    logger.info('Built search options:', options);
    return options;
  }

  private processSearchResults(items: GoogleSearchResult[]): SearchResult[] {
    return items.map(item => ({
      title: item.title || '',
      link: item.link || '',
      snippet: item.snippet || '',
      datePublished: item.pagemap?.metatags?.[0]?.['article:published_time'],
      imageUrl: item.pagemap?.cse_image?.[0]?.src,
    }));
  }

  public validateParams(params: SearchParams): void {
    if (!params.query) {
      throw new SearchError('Search query is required');
    }

    if (params.resultCount && (params.resultCount < 1 || params.resultCount > 10)) {
      throw new SearchError('Result count must be between 1 and 10');
    }

    if (params.dateRestrict && !params.dateRestrict.match(/^[dmy][1-9][0-9]*$/)) {
      throw new SearchError(
        'Invalid date restriction format. Use d[number], m[number], or y[number]'
      );
    }

    // Validate domain formats - Allow subdomains and multi-part TLDs
    const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
    
    if (params.trustedDomains?.some(domain => !domainRegex.test(domain))) {
      throw new SearchError('Invalid trusted domain format');
    }

    if (params.excludedDomains?.some(domain => !domainRegex.test(domain))) {
      throw new SearchError('Invalid excluded domain format');
    }
  }
}

export const searchService = new SearchService();
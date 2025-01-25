# Google Search MCP - Technical Context

## Technology Stack

### Core Technologies
- Bun.js (v1.2+)
- TypeScript
- ESM Modules
- MCP SDK

### External Services
- Google Custom Search API
  - API Key and Search Engine ID required
  - Rate limiting: 100 queries per day for free tier
  - Advanced query parameters:
    * siteSearch: Filter by specific domains
    * siteSearchFilter: Include (i) or exclude (e) domains
    * dateRestrict: Filter by date (d[n], m[n], y[n])
    * orTerms: Match any of these terms
    * exactTerms: Match exact phrases
    * excludeTerms: Exclude specific terms
    * c2coff: Content feature control
    * filter: Duplicate content filter
    * gl: Geolocation boost
    * lr: Language restriction
    * rights: Licensing filters

### Key Dependencies
1. Puppeteer
   - Browser automation
   - JavaScript execution
   - Screenshot capabilities
   - Bot detection avoidance:
     * Custom user agents
     * Stealth plugin integration
     * Runtime fixes
     * Utility world isolation

2. Sharp
   - Image processing
   - Format conversion
   - Quality optimization
   - Memory efficient operations

3. Turndown
   - HTML to Markdown conversion
   - Custom rule support
   - Format preservation
   - Code block handling

4. Winston
   - Structured logging
   - Multiple transports
   - Log levels and formatting
   - Performance tracking

### Infrastructure Components

1. Connection Pool (src/infrastructure/connection-pool.ts)
   - Browser instance management
   - Resource limits
   - Cleanup handling
   - Bot detection avoidance:
     * Runtime patches
     * Source URL masking
     * Utility world naming
     * Debug mode control

2. Rate Limiter (src/infrastructure/rate-limiter.ts)
   - Token bucket algorithm
   - Per-service limits
   - Async operation support
   - Quota management:
     * Daily limits (100 queries)
     * Window-based limits
     * Service-specific quotas
     * Burst handling

3. Cache Manager (src/infrastructure/cache-manager.ts)
   - TTL-based caching
   - Memory monitoring
   - Multiple cache instances
   - Search-specific features:
     * Query normalization
     * Parameter-aware caching
     * Domain-specific TTLs
     * Result freshness control

4. Logger (src/infrastructure/logger.ts)
   - Structured logging
   - Error tracking
   - Performance monitoring
   - Search-specific metrics:
     * Query patterns
     * Domain statistics
     * Cache hit rates
     * Error categorization

## Development Setup

### Environment Variables
```bash
# API Configuration
GOOGLE_API_KEY=your_api_key
GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id

# Resource Limits
MAX_CONCURRENT_BROWSERS=3
BROWSER_TIMEOUT=30000

# Rate Limiting
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX_REQUESTS=60

# Cache Settings
SEARCH_CACHE_TTL=3600
EXTRACT_CACHE_TTL=7200
MAX_CACHE_ITEMS=1000

# Bot Detection Avoidance
REBROWSER_PATCHES_RUNTIME_FIX_MODE=addBinding
REBROWSER_PATCHES_SOURCE_URL=jquery.min.js
REBROWSER_PATCHES_UTILITY_WORLD_NAME=util
REBROWSER_PATCHES_DEBUG=0
```

### Build Configuration
- TypeScript strict mode enabled
- ESM module support
- Source maps enabled
- Declaration files generated

### Type System
- Strict null checks
- No implicit any
- Function type checking
- Template literal validation

### Code Quality
- ESLint with TypeScript support
- Prettier formatting
- Jest testing framework
- Comprehensive error handling

## Performance Considerations

### Browser Management
- Limited concurrent instances
- Connection pooling
- Resource cleanup
- Memory monitoring

### Caching Strategy
- Two-level caching (memory, disk)
- TTL-based expiration
- Size limits
- Stats monitoring

### Rate Limiting
- Token bucket algorithm
- Per-service limits
- Configurable windows
- Bucket cleanup

### Error Handling
- Comprehensive error types
- Stack trace preservation
- Structured logging
- Circuit breaking

## Security Measures

### Input Validation
- Type checking
- Parameter sanitization
- URL validation
- Domain filtering

### Resource Protection
- Rate limiting
- Maximum limits
- Timeout controls
- Memory caps

### API Security
- Key validation
- CORS configuration
- Safe defaults
- Error sanitization

## Monitoring

### Metrics
- Request tracking
- Performance timing
- Resource usage
- Error rates

### Logging
- Structured format
- Level-based filtering
- Context preservation
- Error tracking

### Resource Monitoring
- Memory usage
- Browser instances
- Cache utilization
- Rate limit status

## Search API Specifics

### Query Building
- Parameter normalization
- Domain filtering strategies
- Date restriction formatting
- Result count management

### Response Processing
- Snippet extraction
- Metadata parsing
- Image URL handling
- Date parsing

### Error Categories
- Rate limit exceeded
- Invalid API key
- Malformed query
- Network issues

### Performance Optimization
- Query caching
- Result pagination
- Parallel requests
- Resource pooling
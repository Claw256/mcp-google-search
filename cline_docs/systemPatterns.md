# Google Search MCP - System Patterns

## Architecture Overview

### Service Layer
```
MCP Server
    ├── Search Service
    │   ├── Query Building
    │   ├── Domain Filtering
    │   ├── Result Processing
    │   └── Error Handling
    ├── Extraction Service
    │   ├── Browser Fingerprinting
    │   ├── Bot Detection Evasion
    │   ├── Content Processing
    │   └── Human Behavior Simulation
    └── Screenshot Service
```

### Infrastructure Layer
```
Infrastructure
    ├── Connection Pool
    ├── Rate Limiter
    ├── Cache Manager
    └── Logger
```

## Design Patterns

### Singleton Pattern
- Used for service instances
- Ensures single source of truth
- Manages shared resources
- Example: Connection Pool, Cache Manager

### Factory Pattern
- Browser instance creation
- Service initialization
- Configuration management
- Example: Screenshot Service creation

### Observer Pattern
- Cache events monitoring
- Resource usage tracking
- Error handling
- Example: Logger event subscribers

### Strategy Pattern
- Content extraction strategies
- Rate limiting algorithms
- Cache storage methods
- Example: Different screenshot capture modes

### Proxy Pattern (Extraction Service)
```typescript
// Navigator proxy for bot detection evasion
const handler = {
  get(target: Navigator, prop: PropertyKey): any {
    if (prop === 'webdriver') {
      return false;
    }
    return target[prop];
  },
  getOwnPropertyDescriptor(target: Navigator, prop: PropertyKey): PropertyDescriptor | undefined {
    if (prop === 'webdriver') {
      return undefined;
    }
    return Object.getOwnPropertyDescriptor(target, prop);
  },
  ownKeys(target: Navigator): ArrayLike<string | symbol> {
    return [];
  },
  has(target: Navigator, prop: PropertyKey): boolean {
    if (prop === 'webdriver') {
      return false;
    }
    return prop in target;
  }
};
```

### Builder Pattern (Search Service)
```typescript
class SearchOptionsBuilder {
  private options: Record<string, unknown>;

  constructor(baseQuery: string) {
    this.options = { q: baseQuery };
  }

  withTrustedDomains(domains: string[]): this {
    // Handle single vs multiple domains
    if (domains.length === 1) {
      this.options.siteSearch = domains[0];
      this.options.siteSearchFilter = 'i';
    } else if (domains.length > 1) {
      const sites = domains.map(d => `site:${d}`).join(' OR ');
      this.options.q = `${this.options.q} (${sites})`;
    }
    return this;
  }

  withDateRestriction(dateRestrict: string): this {
    this.options.dateRestrict = dateRestrict;
    return this;
  }

  withResultCount(count: number): this {
    this.options.num = Math.min(Math.max(1, count), 10);
    return this;
  }

  build(): Record<string, unknown> {
    return this.options;
  }
}
```

## Core Principles

### Resource Management
1. Connection Pooling
   - Reuse browser instances
   - Limit concurrent connections
   - Automatic cleanup
   - Resource monitoring

2. Rate Limiting
   - Token bucket algorithm
   - Per-service quotas
   - Automatic recovery
   - Request prioritization

3. Caching
   - Two-level caching
   - TTL-based expiration
   - Memory-aware eviction
   - Stats monitoring

### Error Handling

1. Error Hierarchy
```typescript
BaseError
    ├── SearchError
    │   ├── RateLimitError
    │   ├── InvalidQueryError
    │   ├── ApiError
    │   └── NetworkError
    ├── ExtractionError
    │   ├── BotDetectionError
    │   ├── NavigationError
    │   ├── TimeoutError
    │   └── ContentError
    └── ScreenshotError
```

2. Error Processing
   - Type-safe error handling
   - Detailed error information
   - Stack trace preservation
   - Error recovery strategies

### Type Safety

1. Type Definitions
```typescript
interface ExtractionParams {
  url: string;
  includeImages?: boolean;
  includeVideos?: boolean;
  preserveLinks?: boolean;
  formatCode?: boolean;
  screenshot?: {
    fullPage?: boolean;
    selector?: string;
    format?: 'png' | 'jpeg' | 'webp';
    quality?: number;
  };
}

interface ExtractionResult {
  markdown: string;
  images: ImageMetadata[];
  videos: VideoMetadata[];
  metadata: PageMetadata;
  screenshot?: Buffer;
}
```

2. Validation
   - Runtime type checking
   - Input sanitization
   - Parameter validation
   - Output formatting

## Implementation Patterns

### Service Implementation
```typescript
class ExtractionService {
  private readonly turndown: TurndownService;
  private readonly browserPool: BrowserPool;
  private readonly cache: CacheManager;
  private readonly rateLimiter: RateLimiter;

  constructor() {
    this.validateConfig();
    this.initializeServices();
  }

  public async extract(params: ExtractionParams): Promise<ExtractionResult> {
    this.validateParams(params);
    await this.checkRateLimit(params);
    
    const cached = this.getFromCache(params);
    if (cached) return cached;

    const result = await this.executeExtraction(params);
    this.cacheResult(params, result);
    
    return result;
  }

  private async executeExtraction(params: ExtractionParams): Promise<ExtractionResult> {
    const browser = await this.browserPool.acquire();
    try {
      const page = await browser.newPage();
      await this.configurePage(page);
      await this.simulateHumanBehavior(page);
      return await this.processPage(page, params);
    } finally {
      await this.browserPool.release(browser);
    }
  }
}
```

### Resource Management
```typescript
class ResourceManager {
  // Resource pool
  private resources: Resource[]

  // Acquisition
  public async acquire(): Promise<Resource>

  // Release
  public release(resource: Resource): void

  // Cleanup
  public async cleanup(): Promise<void>
}
```

### Caching Strategy
```typescript
class CacheManager {
  // Cache configuration
  private config: CacheConfig

  // Cache operations
  public get<T>(key: string): T | undefined
  public set<T>(key: string, value: T): boolean
  public del(key: string): void

  // Monitoring
  public getStats(): CacheStats
}
```

## Communication Patterns

### Event-Based
- Cache eviction events
- Resource usage notifications
- Error broadcasts
- Status updates

### Promise-Based
- Async operations
- Resource acquisition
- Error handling
- Cleanup procedures

### Stream-Based
- Content extraction
- Screenshot capture
- Log processing
- Resource monitoring

## Testing Patterns

### Unit Testing
- Service isolation
- Dependency mocking
- Error simulation
- Type verification

### Integration Testing
- Service interaction
- Resource management
- Error propagation
- Performance metrics

### Performance Testing
- Load simulation
- Resource monitoring
- Bottleneck detection
- Optimization validation

## Monitoring Patterns

### Metrics Collection
- Request tracking
- Resource usage
- Error rates
- Performance timing

### Logging Strategy
- Structured logging
- Context preservation
- Error tracking
- Performance monitoring

### Resource Tracking
- Memory usage
- Connection pool
- Cache utilization
- Rate limit status
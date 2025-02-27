// Search Types
export interface SearchParams {
  query: string;
  trustedDomains?: string[];
  excludedDomains?: string[];
  resultCount?: number;
  safeSearch?: boolean;
  dateRestrict?: string;
}

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  datePublished?: string;
  imageUrl?: string;
}

// Content Extraction Types
export interface ViewUrlParams {
  url: string;
  includeImages?: boolean;
  includeVideos?: boolean;
  preserveLinks?: boolean;
  formatCode?: boolean;
}

export interface ImageMetadata {
  url: string;
  alt?: string;
  width?: number;
  height?: number;
  format?: string;
}

export interface VideoMetadata {
  url: string;
  title?: string;
  duration?: number;
  thumbnail?: string;
}

export interface PageMetadata {
  title: string;
  description?: string;
  author?: string;
  publishDate?: string;
  modifiedDate?: string;
  keywords?: string[];
}


export interface ViewUrlResult {
  markdown: string;
  images: ImageMetadata[];
  videos: VideoMetadata[];
  metadata: PageMetadata;
}

// Error Types
export class BaseError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class SearchError extends BaseError {
  constructor(message: string, code: string = 'SEARCH_ERROR', statusCode: number = 500) {
    super(message, code, statusCode);
  }
}

export class ViewUrlError extends BaseError {
  constructor(message: string, code: string = 'VIEW_URL_ERROR', statusCode: number = 500) {
    super(message, code, statusCode);
  }
}

export class RateLimitError extends BaseError {
  constructor(message: string = 'Rate limit exceeded', code: string = 'RATE_LIMIT_ERROR', statusCode: number = 429) {
    super(message, code, statusCode);
  }
}
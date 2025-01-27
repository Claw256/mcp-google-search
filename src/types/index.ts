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
export interface ScreenshotOptions {
  fullPage?: boolean;
  selector?: string;
  format?: 'png' | 'jpeg' | 'webp';
  quality?: number;
}

export interface ExtractionParams {
  url: string;
  includeImages?: boolean;
  includeVideos?: boolean;
  preserveLinks?: boolean;
  formatCode?: boolean;
  screenshot?: ScreenshotOptions;
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

export interface ScreenshotData {
  buffer: string; // base64 encoded image data
  metadata: {
    width: number;
    height: number;
    format: string;
    size: number;
  };
}

export interface ExtractionResult {
  markdown: string;
  images: ImageMetadata[];
  videos: VideoMetadata[];
  metadata: PageMetadata;
  screenshot?: ScreenshotData;
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

export class ExtractionError extends BaseError {
  constructor(message: string, code: string = 'EXTRACTION_ERROR', statusCode: number = 500) {
    super(message, code, statusCode);
  }
}

export class RateLimitError extends BaseError {
  constructor(message: string = 'Rate limit exceeded', code: string = 'RATE_LIMIT_ERROR', statusCode: number = 429) {
    super(message, code, statusCode);
  }
}
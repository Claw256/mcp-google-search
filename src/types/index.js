// Error Types
export class BaseError extends Error {
    code;
    statusCode;
    constructor(message, code, statusCode) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}
export class SearchError extends BaseError {
    constructor(message, code = 'SEARCH_ERROR', statusCode = 500) {
        super(message, code, statusCode);
    }
}
export class ExtractionError extends BaseError {
    constructor(message, code = 'EXTRACTION_ERROR', statusCode = 500) {
        super(message, code, statusCode);
    }
}
export class RateLimitError extends BaseError {
    constructor(message = 'Rate limit exceeded', code = 'RATE_LIMIT_ERROR', statusCode = 429) {
        super(message, code, statusCode);
    }
}

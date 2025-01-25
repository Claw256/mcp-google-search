import winston from 'winston';
const logFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${String(timestamp)} [${String(level)}] : ${String(message)}`;
    if (Object.keys(metadata).length > 0) {
        msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
});
function formatError(error) {
    const metadata = {
        message: error.message,
        name: error.name,
        stack: error.stack,
    };
    // Safely add any additional properties from the error object
    for (const key of Object.getOwnPropertyNames(error)) {
        if (key !== 'message' && key !== 'name' && key !== 'stack') {
            // Safe to do this type assertion since we're explicitly handling Error properties
            const value = error[key];
            if (value !== undefined) {
                metadata[key] = value;
            }
        }
    }
    return metadata;
}
class Logger {
    logger;
    constructor() {
        const logLevel = process.env['LOG_LEVEL'] || 'info';
        const logFormat = process.env['LOG_FORMAT'] || 'json';
        this.logger = winston.createLogger({
            level: logLevel,
            format: winston.format.combine(winston.format.timestamp(), logFormat === 'json' ? winston.format.json() : this.getTextFormat()),
            transports: [
                new winston.transports.Console({
                    format: winston.format.colorize({ all: true }),
                }),
            ],
        });
        // Capture unhandled errors
        this.setupErrorHandling();
    }
    getTextFormat() {
        return winston.format.combine(winston.format.timestamp(), winston.format.align(), logFormat);
    }
    setupErrorHandling() {
        process.on('uncaughtException', (error) => {
            this.error('Uncaught Exception:', formatError(error));
            process.exit(1);
        });
        process.on('unhandledRejection', (reason, promise) => {
            this.error('Unhandled Rejection at:', {
                promise: String(promise),
                reason: reason instanceof Error ? formatError(reason) : String(reason),
            });
        });
    }
    debug(message, meta) {
        this.logger.debug(message, meta);
    }
    info(message, meta) {
        this.logger.info(message, meta);
    }
    warn(message, meta) {
        this.logger.warn(message, meta);
    }
    error(message, meta) {
        if (meta instanceof Error) {
            this.logger.error(message, formatError(meta));
        }
        else {
            this.logger.error(message, meta);
        }
    }
    startTimer() {
        const start = Date.now();
        return () => Date.now() - start;
    }
    async measure(operation, fn) {
        const timer = this.startTimer();
        try {
            const result = await fn();
            const duration = timer();
            this.debug(`${operation} completed`, { duration });
            return result;
        }
        catch (error) {
            const duration = timer();
            this.error(`${operation} failed`, {
                duration,
                error: error instanceof Error ? formatError(error) : String(error),
            });
            throw error;
        }
    }
}
export const logger = new Logger();

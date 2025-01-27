import winston from 'winston';

const logFormat = winston.format.printf(({ level, message, timestamp, ...metadata }): string => {
  let msg = `${String(timestamp)} [${String(level)}] : ${String(message)}`;
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  return msg;
});

interface LogMetadata {
  [key: string]: unknown;
}

function formatError(error: Error): LogMetadata {
  const metadata: LogMetadata = {
    message: error.message,
    name: error.name,
    stack: error.stack,
  };

  // Safely add any additional properties from the error object
  for (const key of Object.getOwnPropertyNames(error)) {
    if (key !== 'message' && key !== 'name' && key !== 'stack') {
      // Safe to do this type assertion since we're explicitly handling Error properties
      const value = (error as unknown as Record<string, unknown>)[key];
      if (value !== undefined) {
        metadata[key] = value;
      }
    }
  }

  return metadata;
}

class Logger {
  private logger: winston.Logger;

  constructor() {
    const logLevel = process.env['LOG_LEVEL'] || 'info';
    const noColor = process.env['NO_COLOR'] === '1' || process.env['BUN_FORCE_COLOR'] === '0' || process.env['FORCE_COLOR'] === '0';

    const consoleFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.align(),
      noColor ? winston.format.uncolorize() : winston.format.colorize({ all: false, message: true }),
      logFormat
    );

    this.logger = winston.createLogger({
      level: logLevel,
      transports: [
        new winston.transports.Console({
          format: consoleFormat,
          stderrLevels: ['error', 'warn', 'info', 'debug'], // Write all logs to stderr
        }),
      ],
    });

    // Capture unhandled errors
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    process.on('uncaughtException', (error: Error) => {
      this.error('Uncaught Exception:', formatError(error));
      process.exit(1);
    });

    process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
      this.error('Unhandled Rejection at:', {
        promise: String(promise),
        reason: reason instanceof Error ? formatError(reason) : String(reason),
      });
    });
  }

  public debug(message: string, meta?: LogMetadata): void {
    this.logger.debug(message, meta);
  }

  public info(message: string, meta?: LogMetadata): void {
    this.logger.info(message, meta);
  }

  public warn(message: string, meta?: LogMetadata): void {
    this.logger.warn(message, meta);
  }

  public error(message: string, meta?: LogMetadata | Error): void {
    if (meta instanceof Error) {
      this.logger.error(message, formatError(meta));
    } else {
      this.logger.error(message, meta);
    }
  }

  public startTimer(): () => number {
    const start = Date.now();
    return () => Date.now() - start;
  }

  public async measure<T>(
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const timer = this.startTimer();
    try {
      const result = await fn();
      const duration = timer();
      this.debug(`${operation} completed`, { duration });
      return result;
    } catch (error) {
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
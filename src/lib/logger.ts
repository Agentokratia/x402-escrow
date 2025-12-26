/**
 * Structured Logging for x402 API
 *
 * Provides consistent logging with correlation IDs and context.
 */

// =============================================================================
// Types
// =============================================================================

export interface LogContext {
  requestId: string;
  scheme?: string;
  network?: string;
  payer?: string;
  amount?: string;
  sessionId?: string;
  [key: string]: unknown;
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  requestId: string;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

// =============================================================================
// Logger Implementation
// =============================================================================

/**
 * Create a logger with a specific request ID for correlation.
 */
export function createLogger(requestId: string) {
  const formatEntry = (
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error
  ): LogEntry => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      requestId,
      message,
    };

    if (context && Object.keys(context).length > 0) {
      entry.context = context;
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      };
    }

    return entry;
  };

  const output = (entry: LogEntry) => {
    // In production, output JSON for log aggregation
    // In development, output human-readable format
    if (process.env.NODE_ENV === 'production') {
      console.log(JSON.stringify(entry));
    } else {
      const ctx = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
      const err = entry.error ? ` [${entry.error.name}: ${entry.error.message}]` : '';
      console.log(
        `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.requestId}] ${entry.message}${ctx}${err}`
      );
    }
  };

  return {
    debug: (message: string, context?: Record<string, unknown>) => {
      if (process.env.NODE_ENV === 'development') {
        output(formatEntry('debug', message, context));
      }
    },
    info: (message: string, context?: Record<string, unknown>) => {
      output(formatEntry('info', message, context));
    },
    warn: (message: string, context?: Record<string, unknown>) => {
      output(formatEntry('warn', message, context));
    },
    error: (message: string, error?: Error, context?: Record<string, unknown>) => {
      output(formatEntry('error', message, context, error));
    },
  };
}

/**
 * Generate a unique request ID.
 */
export function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `req_${timestamp}_${random}`;
}

/**
 * Extract or generate request ID from request headers.
 */
export function getRequestId(request: Request): string {
  return (
    request.headers.get('x-request-id') ||
    request.headers.get('x-correlation-id') ||
    generateRequestId()
  );
}

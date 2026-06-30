import pino from 'pino';
import type { Logger } from 'pino';

import { env } from '../config/env.js';

// ---------------------------------------------------------------------------
// Transport configuration
// ---------------------------------------------------------------------------

function buildTransport(): pino.TransportSingleOptions | undefined {
  if (env.NODE_ENV === 'development') {
    return {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    };
  }
  // Production: plain JSON to stdout (no transport needed)
  return undefined;
}

// ---------------------------------------------------------------------------
// Root logger
// ---------------------------------------------------------------------------

const transport = buildTransport();

export const logger: Logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'linkedin-automation' },
  ...(transport ? { transport } : {}),

  // Redact sensitive fields that might accidentally appear in log context
  redact: {
    paths: [
      'token',
      'accessToken',
      'refreshToken',
      'secret',
      'password',
      'apiKey',
      'SECRET_KEY',
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'STABILITY_API_KEY',
      'LINKEDIN_CLIENT_SECRET',
      'TELEGRAM_BOT_TOKEN',
    ],
    censor: '[REDACTED]',
  },
});

// ---------------------------------------------------------------------------
// Child logger factory
// ---------------------------------------------------------------------------

/**
 * Create a child logger with additional context fields.
 *
 * @example
 * ```ts
 * const log = createChildLogger({ module: 'scheduler' });
 * log.info('Tick');
 * ```
 */
export function createChildLogger(context: Record<string, unknown>): Logger {
  return logger.child(context);
}

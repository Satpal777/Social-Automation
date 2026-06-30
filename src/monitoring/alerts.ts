import { createChildLogger } from './logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AlertLevel = 'info' | 'warning' | 'error' | 'critical';

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

const log = createChildLogger({ module: 'alerts' });

const LEVEL_MAP: Record<AlertLevel, 'info' | 'warn' | 'error' | 'fatal'> = {
  info: 'info',
  warning: 'warn',
  error: 'error',
  critical: 'fatal',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send an alert. Currently logs to the structured logger; Telegram delivery
 * will be wired up in a later milestone.
 */
export async function sendAlert(
  message: string,
  level: AlertLevel = 'info',
  context?: Record<string, unknown>,
): Promise<void> {
  const pinoLevel = LEVEL_MAP[level];

  log[pinoLevel]({ alertLevel: level, ...context }, `[ALERT] ${message}`);

  // TODO: Telegram integration — send to TELEGRAM_CHAT_ID if configured
}

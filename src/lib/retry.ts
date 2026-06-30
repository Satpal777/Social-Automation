import pRetry from 'p-retry';

import { createChildLogger } from '../monitoring/logger.js';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const log = createChildLogger({ module: 'retry' });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute an async function with automatic retries and exponential backoff.
 *
 * @param fn      - The async operation to retry.
 * @param options - Optional config: `retries` (default 3) and a human-readable `label`.
 * @returns The resolved value of `fn`.
 *
 * @example
 * ```ts
 * const data = await withRetry(() => fetchFromApi(), { retries: 5, label: 'fetchFromApi' });
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: { retries?: number; label?: string },
): Promise<T> {
  const { retries = 3, label = 'operation' } = options ?? {};

  return pRetry(fn, {
    retries,
    onFailedAttempt(error) {
      log.warn(
        {
          label,
          attempt: error.attemptNumber,
          retriesLeft: error.retriesLeft,
          message: error.message,
        },
        `Retry attempt ${error.attemptNumber}/${retries} for "${label}" failed — ${error.retriesLeft} retries left`,
      );
    },
  });
}

import { z } from 'zod';
import { env } from '../../config/env.js';
import { logger } from '../../monitoring/logger.js';
import { withRetry } from '../../lib/retry.js';
import { ConfigError } from '../../lib/errors.js';

const log = logger.child({ module: 'tavily-client' });

const tavilyResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      content: z.string(),
    })
  ),
});

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
}

/**
 * Query Tavily's web search API for fresh, real-world results — used to ground
 * LLM topic ideation in current information instead of the model's own
 * (potentially stale) training data.
 */
export async function searchTavily(
  query: string,
  options: {
    maxResults?: number;
    includeDomains?: string[];
    days?: number;
    topic?: 'general' | 'news';
  } = {}
): Promise<TavilySearchResult[]> {
  const apiKey = env.SEARCH_API_KEY;
  if (!apiKey) {
    throw new ConfigError('SEARCH_API_KEY is not configured');
  }

  const { maxResults = 8, includeDomains, days = 14, topic = 'news' } = options;

  const runCall = async () => {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        topic,
        max_results: maxResults,
        days,
        ...(includeDomains && includeDomains.length > 0 ? { include_domains: includeDomains } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Tavily search failed: ${res.status} ${res.statusText} — ${body}`);
    }

    const json = await res.json();
    return tavilyResponseSchema.parse(json).results;
  };

  log.info({ query, maxResults, topic, includeDomains }, 'Calling Tavily search API');
  const results = await withRetry(runCall, { retries: 2, label: 'Tavily search' });
  log.info({ query, resultCount: results.length }, 'Tavily search returned results');
  return results;
}

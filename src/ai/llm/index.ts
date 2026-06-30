import { env } from '../../config/env.js';
import { ClaudeProvider } from './claude-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { OpenRouterProvider } from './openrouter-provider.js';
import type { LLMProvider } from './types.js';

let cachedProvider: LLMProvider | null = null;

export * from './types.js';
export { ClaudeProvider } from './claude-provider.js';
export { OpenAIProvider } from './openai-provider.js';
export { OpenRouterProvider } from './openrouter-provider.js';

/**
 * Retrieve the configured LLMProvider instance (singleton).
 */
export function getLLMProvider(): LLMProvider {
  if (cachedProvider) {
    return cachedProvider;
  }

  const providerType = env.LLM_PROVIDER;

  if (providerType === 'openai') {
    cachedProvider = new OpenAIProvider();
  } else if (providerType === 'openrouter') {
    cachedProvider = new OpenRouterProvider();
  } else {
    // Default to anthropic
    cachedProvider = new ClaudeProvider();
  }

  return cachedProvider;
}

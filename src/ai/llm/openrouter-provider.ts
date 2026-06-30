import OpenAI from 'openai';
import { env } from '../../config/env.js';
import { logger } from '../../monitoring/logger.js';
import { withRetry } from '../../lib/retry.js';
import { LLMProviderError } from '../../lib/errors.js';
import type { LLMProvider, LLMResult, PromptSpec } from './types.js';

export class OpenRouterProvider implements LLMProvider {
  private client: OpenAI | null = null;
  private readonly log = logger.child({ module: 'openrouter-provider' });

  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new LLMProviderError('OPENROUTER_API_KEY is not configured');
      }
      this.client = new OpenAI({
        apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': env.APP_BASE_URL,
          'X-Title': 'LinkedIn Content Automation',
        },
      });
    }
    return this.client;
  }

  private resolveModel(tier?: 'fast' | 'smart'): string {
    if (tier === 'fast') {
      return env.LLM_FAST_MODEL || 'meta-llama/llama-3-8b-instruct:free';
    }
    // Default to smart
    return env.LLM_SMART_MODEL || env.OPENROUTER_MODEL;
  }

  async generate(prompt: PromptSpec): Promise<LLMResult> {
    const client = this.getClient();
    const model = this.resolveModel(prompt.tier);

    const runCall = async () => {
      try {
        this.log.info({ model, tier: prompt.tier }, 'Sending request to OpenRouter API');
        const completion = await client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          max_tokens: prompt.maxTokens,
          temperature: prompt.temperature ?? 0.7,
        });

        const choice = completion.choices[0];
        const content = choice?.message?.content;
        if (content === null || content === undefined) {
          throw new LLMProviderError('OpenRouter response was empty');
        }

        return {
          content,
          model,
          usage: {
            inputTokens: completion.usage?.prompt_tokens ?? 0,
            outputTokens: completion.usage?.completion_tokens ?? 0,
          },
        };
      } catch (err: any) {
        if (err instanceof LLMProviderError) throw err;
        throw new LLMProviderError(`OpenRouter API request failed: ${err.message}`, { cause: err });
      }
    };

    return withRetry(runCall, { label: 'LLM generate (OpenRouter)' });
  }

  async embed(text: string): Promise<number[]> {
    const client = this.getClient();
    // Use standard embedding model available on OpenRouter or fallback to local representation
    const model = 'openai/text-embedding-3-small';

    const runCall = async () => {
      try {
        this.log.info('Generating embedding via OpenRouter API');
        const response = await client.embeddings.create({
          model,
          input: text,
        });

        const embedding = response.data[0]?.embedding;
        if (!embedding) {
          throw new LLMProviderError('OpenRouter embedding response was empty');
        }

        return embedding;
      } catch (err: any) {
        if (err instanceof LLMProviderError) throw err;
        throw new LLMProviderError(`OpenRouter Embedding request failed: ${err.message}`, { cause: err });
      }
    };

    return withRetry(runCall, { label: 'LLM embed (OpenRouter)' });
  }
}

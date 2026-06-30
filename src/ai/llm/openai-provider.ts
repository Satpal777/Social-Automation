import OpenAI from 'openai';
import { env } from '../../config/env.js';
import { logger } from '../../monitoring/logger.js';
import { withRetry } from '../../lib/retry.js';
import { LLMProviderError } from '../../lib/errors.js';
import type { LLMProvider, LLMResult, PromptSpec } from './types.js';

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI | null = null;
  private readonly log = logger.child({ module: 'openai-provider' });

  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new LLMProviderError('OPENAI_API_KEY is not configured');
      }
      this.client = new OpenAI({ apiKey });
    }
    return this.client;
  }

  async generate(prompt: PromptSpec): Promise<LLMResult> {
    const client = this.getClient();
    const model = env.OPENAI_MODEL;

    const runCall = async () => {
      try {
        this.log.info({ model }, 'Sending request to OpenAI API');
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
          throw new LLMProviderError('OpenAI response was empty');
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
        throw new LLMProviderError(`OpenAI API request failed: ${err.message}`, { cause: err });
      }
    };

    return withRetry(runCall, { label: 'LLM generate (OpenAI)' });
  }

  async embed(text: string): Promise<number[]> {
    const client = this.getClient();
    const model = 'text-embedding-3-small';

    const runCall = async () => {
      try {
        this.log.info('Generating embedding via OpenAI API');
        const response = await client.embeddings.create({
          model,
          input: text,
        });

        const embedding = response.data[0]?.embedding;
        if (!embedding) {
          throw new LLMProviderError('OpenAI embedding response was empty');
        }

        return embedding;
      } catch (err: any) {
        if (err instanceof LLMProviderError) throw err;
        throw new LLMProviderError(`OpenAI Embedding request failed: ${err.message}`, { cause: err });
      }
    };

    return withRetry(runCall, { label: 'LLM embed (OpenAI)' });
  }
}

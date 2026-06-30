import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { logger } from '../../monitoring/logger.js';
import { withRetry } from '../../lib/retry.js';
import { LLMProviderError } from '../../lib/errors.js';
import type { LLMProvider, LLMResult, PromptSpec } from './types.js';

export class ClaudeProvider implements LLMProvider {
  private client: Anthropic | null = null;
  private readonly log = logger.child({ module: 'claude-provider' });

  private getClient(): Anthropic {
    if (!this.client) {
      const apiKey = env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new LLMProviderError('ANTHROPIC_API_KEY is not configured');
      }
      this.client = new Anthropic({ apiKey });
    }
    return this.client;
  }

  async generate(prompt: PromptSpec): Promise<LLMResult> {
    const client = this.getClient();
    const model = env.ANTHROPIC_MODEL;

    const runCall = async () => {
      try {
        this.log.info({ model }, 'Sending request to Anthropic API');
        const message = await client.messages.create({
          model,
          max_tokens: prompt.maxTokens ?? 4000,
          temperature: prompt.temperature ?? 0.7,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
        });

        const textContent = message.content.find((block) => block.type === 'text');
        if (!textContent || textContent.type !== 'text') {
          throw new LLMProviderError('Anthropic response did not contain a text block');
        }

        return {
          content: textContent.text,
          model,
          usage: {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
          },
        };
      } catch (err: any) {
        if (err instanceof LLMProviderError) throw err;
        throw new LLMProviderError(`Anthropic API request failed: ${err.message}`, { cause: err });
      }
    };

    return withRetry(runCall, { label: 'LLM generate (Claude)' });
  }
}

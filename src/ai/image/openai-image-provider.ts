import OpenAI from 'openai';
import { env } from '../../config/env.js';
import { logger } from '../../monitoring/logger.js';
import { withRetry } from '../../lib/retry.js';
import { LLMProviderError } from '../../lib/errors.js';
import type { GeneratedImage, ImageOptions, ImageProvider } from './types.js';

export class OpenAIImageProvider implements ImageProvider {
  private client: OpenAI | null = null;
  private readonly log = logger.child({ module: 'openai-image-provider' });

  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new LLMProviderError('OPENAI_API_KEY is not configured for image generation');
      }
      this.client = new OpenAI({ apiKey });
    }
    return this.client;
  }

  async generate(prompt: string, options?: ImageOptions): Promise<GeneratedImage> {
    const client = this.getClient();
    const model = env.OPENAI_IMAGE_MODEL || 'dall-e-3';

    const runCall = async (): Promise<GeneratedImage> => {
      try {
        this.log.info({ model, promptLength: prompt.length }, 'Requesting image generation from OpenAI');
        const response = await client.images.generate({
          model,
          prompt,
          n: 1,
          size: options?.size ?? '1024x1024',
          quality: options?.quality ?? 'standard',
          response_format: 'b64_json',
        });

        const b64Data = response.data?.[0]?.b64_json;
        if (!b64Data) {
          throw new LLMProviderError('OpenAI image generation returned empty b64 data');
        }

        return { buffer: Buffer.from(b64Data, 'base64'), mime: 'image/png' };
      } catch (err: any) {
        if (err instanceof LLMProviderError) throw err;
        throw new LLMProviderError(`OpenAI image generation failed: ${err.message}`, { cause: err });
      }
    };

    return withRetry(runCall, { label: 'Image generate (OpenAI)' });
  }
}

import { env } from '../../config/env.js';
import { logger } from '../../monitoring/logger.js';
import { withRetry } from '../../lib/retry.js';
import { LLMProviderError } from '../../lib/errors.js';
import type { GeneratedImage, ImageOptions, ImageProvider } from './types.js';

/** Maps the shared ImageOptions.size enum to Cloudflare's width/height fields. */
function sizeToDimensions(size?: ImageOptions['size']): { width: number; height: number } | null {
  switch (size) {
    case '1024x1792':
      return { width: 1024, height: 1792 };
    case '1792x1024':
      return { width: 1792, height: 1024 };
    case '1024x1024':
      return { width: 1024, height: 1024 };
    default:
      return null;
  }
}

/**
 * Cloudflare models don't consistently declare an image format for
 * base64-embedded JSON responses (e.g. Flux returns JPEG bytes with no
 * format field), so we sniff the magic bytes to report the real mime type.
 */
function sniffImageMime(buffer: Buffer): 'image/png' | 'image/jpeg' {
  const isPng =
    buffer.length >= 4 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;
  return isPng ? 'image/png' : 'image/jpeg';
}

/**
 * Image generation via Cloudflare Workers AI (free-tier neuron allocation).
 * Default model is a fast text-to-image model; override with CLOUDFLARE_IMAGE_MODEL.
 */
export class CloudflareImageProvider implements ImageProvider {
  private readonly log = logger.child({ module: 'cloudflare-image-provider' });

  private getCredentials(): { accountId: string; apiToken: string } {
    const accountId = env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !apiToken) {
      throw new LLMProviderError(
        'CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN are not configured for image generation'
      );
    }
    return { accountId, apiToken };
  }

  async generate(prompt: string, options?: ImageOptions): Promise<GeneratedImage> {
    const { accountId, apiToken } = this.getCredentials();
    const model = env.CLOUDFLARE_IMAGE_MODEL;
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
    const dimensions = sizeToDimensions(options?.size);

    const runCall = async (): Promise<GeneratedImage> => {
      try {
        this.log.info(
          { model, promptLength: prompt.length },
          'Requesting image generation from Cloudflare Workers AI'
        );

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prompt, ...(dimensions ?? {}) }),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new LLMProviderError(
            `Cloudflare Workers AI request failed: ${res.status} ${res.statusText} — ${body}`
          );
        }

        // Some models (e.g. Stable Diffusion) return raw image bytes; others
        // (e.g. Flux) return JSON with a base64-encoded image and no reliable
        // format field, so the actual format is sniffed from the bytes.
        const contentType = res.headers.get('content-type') ?? '';
        if (contentType.startsWith('image/')) {
          const arrayBuffer = await res.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const mime = contentType.startsWith('image/png') ? 'image/png' : sniffImageMime(buffer);
          return { buffer, mime };
        }

        const json: any = await res.json();
        if (json?.success === false) {
          const messages = (json.errors ?? []).map((e: any) => e.message).join('; ');
          throw new LLMProviderError(
            `Cloudflare Workers AI returned an error: ${messages || 'unknown error'}`
          );
        }

        const b64 = json?.result?.image;
        if (!b64) {
          throw new LLMProviderError('Cloudflare Workers AI response did not include image data');
        }
        const buffer = Buffer.from(b64, 'base64');
        return { buffer, mime: sniffImageMime(buffer) };
      } catch (err: any) {
        if (err instanceof LLMProviderError) throw err;
        throw new LLMProviderError(`Cloudflare Workers AI image generation failed: ${err.message}`, {
          cause: err,
        });
      }
    };

    return withRetry(runCall, { label: 'Image generate (Cloudflare Workers AI)' });
  }
}

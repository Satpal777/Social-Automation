import { env } from '../../config/env.js';
import { logger } from '../../monitoring/logger.js';
import { OpenAIImageProvider } from './openai-image-provider.js';
import { CloudflareImageProvider } from './cloudflare-image-provider.js';
import type { ImageProvider } from './types.js';

let cachedProvider: ImageProvider | null = null;

export * from './types.js';
export { OpenAIImageProvider } from './openai-image-provider.js';
export { CloudflareImageProvider } from './cloudflare-image-provider.js';

/**
 * Retrieve the configured ImageProvider instance (singleton).
 * Returns null if IMAGE_PROVIDER is set to 'none' or not configured.
 */
export function getImageProvider(): ImageProvider | null {
  if (env.IMAGE_PROVIDER === 'none') {
    return null;
  }

  if (cachedProvider) {
    return cachedProvider;
  }

  const providerType = env.IMAGE_PROVIDER;
  logger.info({ providerType }, 'Instantiating Image provider');

  if (providerType === 'openai') {
    cachedProvider = new OpenAIImageProvider();
  } else if (providerType === 'cloudflare') {
    cachedProvider = new CloudflareImageProvider();
  } else if (providerType === 'stability') {
    // Stability AI is stubbed out for now
    throw new Error('Stability Image Provider is not yet implemented');
  }

  return cachedProvider;
}

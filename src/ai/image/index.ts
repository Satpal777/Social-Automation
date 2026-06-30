import { env } from '../../config/env.js';
import { OpenAIImageProvider } from './openai-image-provider.js';
import type { ImageProvider } from './types.js';

let cachedProvider: ImageProvider | null = null;

export * from './types.js';
export { OpenAIImageProvider } from './openai-image-provider.js';

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

  if (providerType === 'openai') {
    cachedProvider = new OpenAIImageProvider();
  } else if (providerType === 'stability') {
    // Stability AI is stubbed out for now
    throw new Error('Stability Image Provider is not yet implemented');
  }

  return cachedProvider;
}

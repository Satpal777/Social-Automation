import type { ContentItem } from '@prisma/client';
import { publishTextPost } from './publishers/text.js';
import { publishImagePost } from './publishers/image.js';
import { publishDocumentPost } from './publishers/document.js';
import { assetRepository } from '../db/repositories/asset.repository.js';

/**
 * Unified publish router that delegates to the format-specific publishers.
 */
export async function publish(contentItem: ContentItem): Promise<{ urn: string; url: string }> {
  // Check if there are assets attached
  const assets = await assetRepository.findByContentItemId(contentItem.id);

  if (contentItem.format === 'carousel') {
    const hasPdf = assets.some((a) => a.type === 'pdf');
    if (hasPdf) {
      return publishDocumentPost(contentItem);
    }
  }

  if (contentItem.format === 'image' || contentItem.format === 'infographic') {
    const hasImage = assets.some((a) => a.type === 'image' || a.type === 'infographic');
    if (hasImage) {
      return publishImagePost(contentItem);
    }
  }

  // Fallback to text post if no assets are rendered or format is text
  return publishTextPost(contentItem);
}

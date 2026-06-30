import type { ContentItem } from '@prisma/client';
import { createLinkedInClient } from '../client.js';
import { getValidToken } from '../oauth.js';
import { contentItemRepository } from '../../db/repositories/content-item.repository.js';
import { publishLogRepository } from '../../db/repositories/publish-log.repository.js';
import { PublishError } from '../../lib/errors.js';
import { logger } from '../../monitoring/logger.js';

/**
 * Format the content item fields into a single post string.
 */
export function formatPostText(content: {
  hook: string;
  body: string;
  cta?: string | null;
  hashtags: string[];
}): string {
  const parts = [content.hook.trim(), content.body.trim()];
  if (content.cta?.trim()) {
    parts.push(content.cta.trim());
  }
  if (content.hashtags.length > 0) {
    const formattedTags = content.hashtags
      .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
      .join(' ');
    parts.push(formattedTags);
  }
  return parts.join('\n\n');
}

/**
 * Publishes a text post to LinkedIn.
 */
export async function publishTextPost(contentItem: ContentItem): Promise<{ urn: string; url: string }> {
  const contentItemId = contentItem.id;
  const log = logger.child({ contentItemId, module: 'linkedin-publisher' });

  // 1. Idempotency guard: get fresh status from DB
  const freshItem = await contentItemRepository.findById(contentItemId);
  if (!freshItem) {
    throw new PublishError('Content item not found in database', contentItemId);
  }

  if (freshItem.status === 'published') {
    log.warn('Content item is already published, skipping');
    return {
      urn: freshItem.linkedinUrn || '',
      url: freshItem.linkedinUrl || '',
    };
  }

  if (freshItem.status === 'publishing') {
    throw new PublishError('Content item is currently being published in another process', contentItemId);
  }

  // 2. Transition status to publishing
  await contentItemRepository.updateStatus(contentItemId, 'publishing');
  
  const latestAttempt = await publishLogRepository.getLatestAttempt(contentItemId);
  const currentAttempt = latestAttempt + 1;

  // Format post text
  const commentary = formatPostText({
    hook: freshItem.hook,
    body: freshItem.body,
    cta: freshItem.cta,
    hashtags: freshItem.hashtags,
  });

  const requestBody = {
    author: '', // Will be set below
    commentary,
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED' },
    lifecycleState: 'PUBLISHED',
  };

  try {
    // 3. Get valid token & author member URN
    const { memberUrn } = await getValidToken();
    requestBody.author = memberUrn;

    log.info({ attempt: currentAttempt }, 'Publishing text post to LinkedIn');
    const client = await createLinkedInClient();

    const response = await client.post('/rest/posts', requestBody);
    
    // Extract URN
    // x-restli-id is returned in the headers of some versions, or in response body under 'id'
    let urn = response?.id || response?.headers?.['x-restli-id'];
    if (!urn && response?.headers) {
      // Find case-insensitive header
      const match = Object.entries(response.headers).find(([k]) => k.toLowerCase() === 'x-restli-id');
      if (match) urn = match[1];
    }

    if (!urn) {
      // If we don't get the URN but the request succeeded, throw or use fallback
      log.warn({ response }, 'LinkedIn post succeeded but no x-restli-id header was returned');
      urn = `urn:li:share:fallback-${contentItemId}`;
    }

    const url = `https://www.linkedin.com/feed/update/${urn}`;

    // 4. Update status to published
    await contentItemRepository.updateStatus(contentItemId, 'published', {
      linkedinUrn: urn,
      linkedinUrl: url,
      publishedAt: new Date(),
    });

    // Write success log
    await publishLogRepository.create({
      contentItem: { connect: { id: contentItemId } },
      attempt: currentAttempt,
      status: 'success',
      request: requestBody as any,
      response: response as any,
    });

    log.info({ urn }, 'Successfully published text post to LinkedIn');
    return { urn, url };
  } catch (err: any) {
    log.error({ err }, 'Failed to publish text post to LinkedIn');

    // Restore status to failed so it can be retried later
    await contentItemRepository.updateStatus(contentItemId, 'failed');

    // Write failure log
    await publishLogRepository.create({
      contentItem: { connect: { id: contentItemId } },
      attempt: currentAttempt,
      status: 'failure',
      request: requestBody as any,
      error: err.message || 'Unknown error',
      response: err.context?.response || null,
    });

    throw new PublishError(`LinkedIn publishing failed: ${err.message}`, contentItemId, { cause: err });
  }
}

import type { ContentItem } from '@prisma/client';
import { createLinkedInClient } from '../client.js';
import { getValidToken } from '../oauth.js';
import { contentItemRepository } from '../../db/repositories/content-item.repository.js';
import { assetRepository } from '../../db/repositories/asset.repository.js';
import { publishLogRepository } from '../../db/repositories/publish-log.repository.js';
import { PublishError } from '../../lib/errors.js';
import { logger } from '../../monitoring/logger.js';
import { formatPostText } from './text.js';
import fs from 'node:fs/promises';

/**
 * Publishes a document (PDF carousel) post to LinkedIn.
 */
export async function publishDocumentPost(contentItem: ContentItem): Promise<{ urn: string; url: string }> {
  const contentItemId = contentItem.id;
  const log = logger.child({ contentItemId, module: 'linkedin-document-publisher' });

  // 1. Idempotency guard
  const freshItem = await contentItemRepository.findById(contentItemId);
  if (!freshItem) {
    throw new PublishError('Content item not found in database', contentItemId);
  }

  if (freshItem.status === 'published') {
    return { urn: freshItem.linkedinUrn || '', url: freshItem.linkedinUrl || '' };
  }

  // 2. Fetch associated PDF asset
  const assets = await assetRepository.findByContentItemId(contentItemId);
  const pdfAsset = assets.find((a) => a.type === 'pdf');
  if (!pdfAsset) {
    throw new PublishError('No PDF document asset found for this content item', contentItemId);
  }

  await contentItemRepository.updateStatus(contentItemId, 'publishing');
  const latestAttempt = await publishLogRepository.getLatestAttempt(contentItemId);
  const currentAttempt = latestAttempt + 1;

  const commentary = formatPostText({
    hook: freshItem.hook,
    body: freshItem.body,
    cta: freshItem.cta,
    hashtags: freshItem.hashtags,
  });

  const requestBody = {
    author: '',
    commentary,
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED' },
    lifecycleState: 'PUBLISHED',
    content: {
      media: {
        id: '',
        title: freshItem.title || 'Tech Presentation / Carousel',
      },
    },
  };

  try {
    const { memberUrn } = await getValidToken();
    requestBody.author = memberUrn;

    // Read PDF file bytes from disk
    const fileBytes = await fs.readFile(pdfAsset.path);

    log.info('Initializing LinkedIn document upload');
    const client = await createLinkedInClient();

    // Initialize Upload
    const initRes = await client.post('/rest/documents?action=initializeUpload', {
      initializeUploadRequest: {
        owner: memberUrn,
      },
    });

    const uploadUrl = initRes.value?.uploadUrl || initRes.uploadUrl;
    const documentUrn = initRes.value?.document || initRes.document;

    if (!uploadUrl || !documentUrn) {
      throw new Error('Failed to retrieve uploadUrl or documentUrn from LinkedIn initialization response');
    }

    log.info({ documentUrn }, 'Uploading document binary payload');
    
    // Upload bytes via PUT
    await client.put(uploadUrl, fileBytes, pdfAsset.mime);

    // Update request body with uploaded URN
    requestBody.content.media.id = documentUrn;

    log.info({ attempt: currentAttempt }, 'Creating LinkedIn document post');
    const response = await client.post('/rest/posts', requestBody);

    const urn = response?.id || response?.headers?.['x-restli-id'] || documentUrn;
    const url = `https://www.linkedin.com/feed/update/${urn}`;

    await contentItemRepository.updateStatus(contentItemId, 'published', {
      linkedinUrn: urn,
      linkedinUrl: url,
      publishedAt: new Date(),
    });

    await publishLogRepository.create({
      contentItem: { connect: { id: contentItemId } },
      attempt: currentAttempt,
      status: 'success',
      request: requestBody as any,
      response: response as any,
    });

    log.info('Document post successfully published');
    return { urn, url };
  } catch (err: any) {
    log.error({ err }, 'Failed to publish document post');
    await contentItemRepository.updateStatus(contentItemId, 'failed');

    await publishLogRepository.create({
      contentItem: { connect: { id: contentItemId } },
      attempt: currentAttempt,
      status: 'failure',
      request: requestBody as any,
      error: err.message,
      response: err.context?.response || null,
    });

    throw new PublishError(`LinkedIn document publishing failed: ${err.message}`, contentItemId, { cause: err });
  }
}

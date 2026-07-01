import type { ContentItem, Topic } from '@prisma/client';
import { ResearchService } from '../ai/research/research-service.js';
import { generateContent } from './generator.js';
import { contentItemRepository } from '../db/repositories/content-item.repository.js';
import { topicRepository } from '../db/repositories/topic.repository.js';
import { assetRepository } from '../db/repositories/asset.repository.js';
import { CarouselRenderer, InfographicRenderer } from '../assets/index.js';
import { getImageProvider } from '../ai/index.js';
import { logger } from '../monitoring/logger.js';
import { ValidationError } from '../lib/errors.js';
import { env } from '../config/env.js';
import type { SlotConfig, GeneratedContent } from './types.js';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Compute simple Jaccard similarity between two strings based on 3-character shingles.
 */
function getJaccardSimilarity(a: string, b: string): number {
  const getShingles = (str: string) => {
    const clean = str.toLowerCase().replace(/[^a-z0-9]/g, '');
    const shingles = new Set<string>();
    for (let i = 0; i < clean.length - 2; i++) {
      shingles.add(clean.substring(i, i + 3));
    }
    return shingles;
  };

  const shinglesA = getShingles(a);
  const shinglesB = getShingles(b);

  if (shinglesA.size === 0 || shinglesB.size === 0) return 0;

  const intersection = new Set([...shinglesA].filter((x) => shinglesB.has(x)));
  const union = new Set([...shinglesA, ...shinglesB]);

  return intersection.size / union.size;
}

/**
 * Checks uniqueness of the generated content against recent posts.
 */
async function checkUniqueness(content: GeneratedContent, threshold = 0.6): Promise<boolean> {
  const recentItems = await contentItemRepository.findRecent(30);
  const newText = `${content.hook} ${content.body}`;

  for (const item of recentItems) {
    const existingText = `${item.hook} ${item.body}`;
    const similarity = getJaccardSimilarity(newText, existingText);
    if (similarity > threshold) {
      logger.warn(
        { existingId: item.id, similarity },
        'Uniqueness gate failed: generated content is too similar to an existing post'
      );
      return false;
    }
  }

  return true;
}

/**
 * Main orchestrator function for running a content generation job.
 */
export async function runContentJob(slot: SlotConfig): Promise<ContentItem> {
  const correlationId = Math.random().toString(36).substring(2, 10);
  const log = logger.child({ module: 'orchestrator', correlationId, slot });

  log.info('Starting content job');

  // 1. Determine Pillar and Format
  const pillar = slot.pillar || 'software-engineering';
  const format = slot.format || 'text';

  // 2. RESEARCH - Get topics
  log.info({ pillar }, 'Research phase starting');
  const topics = await ResearchService.findTopics(pillar);
  log.info({ pillar, topicsFound: topics.length }, 'Research phase complete');
  if (topics.length === 0) {
    throw new Error(`No research topics found or generated for pillar: ${pillar}`);
  }

  // Pick the first unused topic
  const selectedTopic = topics[0] as Topic;
  log.info({ topicId: selectedTopic.id, topicTitle: selectedTopic.title }, 'Selected topic for content generation');

  // Get recent hooks for prompts
  const recentItems = await contentItemRepository.findRecent(10);
  const recentHooks = recentItems.map((item) => item.hook);

  // 3. GENERATE content
  let generated: GeneratedContent | null = null;
  const maxUniquenessAttempts = 3;

  for (let attempt = 1; attempt <= maxUniquenessAttempts; attempt++) {
    log.info({ attempt, format }, 'Generating candidate content');
    const candidate = await generateContent(pillar, format, selectedTopic, recentHooks);

    // Check uniqueness gate
    const isUnique = await checkUniqueness(candidate);
    if (isUnique) {
      log.info({ attempt }, 'Uniqueness gate passed');
      generated = candidate;
      break;
    }

    log.warn({ attempt }, 'Generated content failed uniqueness check. Regenerating.');
  }

  if (!generated) {
    throw new ValidationError(
      `Failed to generate unique content for topic: "${selectedTopic.title}" after ${maxUniquenessAttempts} attempts.`
    );
  }

  log.info(
    {
      hookLength: generated.hook.length,
      bodyLength: generated.body.length,
      hashtagCount: generated.hashtags.length,
    },
    'Content generation succeeded'
  );

  // 4. Determine status based on publishing mode and format
  // Polls always become manual_required (API limit)
  let status = 'pending_review';
  if (format === 'poll') {
    status = 'manual_required';
  } else if (slot.mode === 'auto') {
    status = 'approved';
  } else if (slot.mode === 'silent') {
    status = 'generated';
  }

  // Calculate scheduledAt for Auto publishing (default: scheduled 1 minute from now or slot schedule)
  const scheduledAt = slot.mode === 'auto' ? new Date(Date.now() + 60 * 1000) : null;

  // Create dedupe key (hash of normalized body to prevent double posting)
  const cleanBody = generated.body.toLowerCase().replace(/\s+/g, '');
  const dedupeKey = `dedupe_${cleanBody.substring(0, 50)}_${selectedTopic.id.substring(0, 8)}`;

  // 5. PERSIST
  log.info({ status }, 'Persisting generated content item');
  const contentItem = await contentItemRepository.create({
    pillar,
    format,
    status: status as any,
    mode: slot.mode,
    title: selectedTopic.title,
    hook: generated.hook,
    body: generated.body,
    cta: generated.cta,
    hashtags: generated.hashtags,
    scheduledAt,
    sourceTopic: { connect: { id: selectedTopic.id } },
    dedupeKey,
    generationMeta: {
      correlationId,
      slides: generated.slides || null,
      pollQuestion: generated.pollQuestion || null,
      pollOptions: generated.pollOptions || null,
    } as any,
  });

  // Mark the topic as used
  await topicRepository.markUsed(selectedTopic.id);

  // 6. Generate Visual Assets
  if (format === 'carousel' && generated.slides) {
    try {
      log.info('Generating Carousel PDF asset');
      await CarouselRenderer.render(contentItem.id, generated.slides, contentItem.title || 'Technical Insight');
    } catch (err) {
      log.error({ err }, 'Failed to render carousel PDF asset');
    }
  } else if (format === 'infographic') {
    try {
      log.info('Generating Infographic PNG asset');
      await InfographicRenderer.render(
        contentItem.id,
        contentItem.title || 'Technical Insight',
        contentItem.body,
        contentItem.cta
      );
    } catch (err) {
      log.error({ err }, 'Failed to render infographic PNG asset');
    }
  } else if (format === 'image') {
    const imageProvider = getImageProvider();
    if (imageProvider) {
      try {
        log.info('Generating AI image asset');
        const imgPrompt = `Detailed, content-rich digital illustration for a LinkedIn tech post titled: "${contentItem.title}". Context: ${contentItem.hook}
Depict the concrete idea, not an abstract mood: include specific, recognizable visual elements tied directly to the topic — e.g. relevant diagrams, workflow steps, code/UI fragments, system components, or labeled icons that make the technical concept legible at a glance. Compose it as a dense, information-rich editorial scene (not a single minimalist icon or empty abstract background). Professional tech-editorial style, dark background, vibrant accent colors, high detail, suitable as a LinkedIn hero image.`;
        const { buffer, mime } = await imageProvider.generate(imgPrompt);

        await fs.mkdir(env.ASSETS_DIR, { recursive: true });
        const ext = mime === 'image/png' ? 'png' : 'jpg';
        const imgFilename = `${contentItem.id}-image.${ext}`;
        const imgPath = path.join(env.ASSETS_DIR, imgFilename);

        await fs.writeFile(imgPath, buffer);

        await assetRepository.create({
          contentItem: { connect: { id: contentItem.id } },
          type: 'image',
          path: imgPath,
          mime,
        });
        log.info({ imgPath, mime }, 'AI image asset successfully generated and saved');
      } catch (err) {
        log.error({ err }, 'Failed to generate AI image asset');
      }
    }
  }

  log.info({ contentItemId: contentItem.id }, 'Content job completed successfully');
  
  return contentItem;
}

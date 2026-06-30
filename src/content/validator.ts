import type { ContentFormat } from '@prisma/client';
import { ValidationError } from '../lib/errors.js';
import type { GeneratedContent } from './types.js';

/**
 * Validate generated content according to format rules.
 * Throws ValidationError if rules are violated.
 */
export function validateContent(content: GeneratedContent, format: ContentFormat): void {
  // 1. Basic text validations
  if (!content.hook || content.hook.trim().length === 0) {
    throw new ValidationError('Content hook is missing or empty');
  }
  if (!content.body || content.body.trim().length === 0) {
    throw new ValidationError('Content body is missing or empty');
  }

  // Hook length constraint (max 140 chars for "see more" click)
  if (content.hook.length > 140) {
    throw new ValidationError(`Content hook is too long (${content.hook.length} chars). Max is 140.`);
  }

  // Total body length constraint (LinkedIn max is ~3000 chars)
  const totalLength = content.body.length;
  if (totalLength > 3000) {
    throw new ValidationError(`Content body is too long (${totalLength} chars). Max is 3000.`);
  }

  // 2. Hashtag validations (3 to 5 hashtags, no duplicates)
  if (!content.hashtags || content.hashtags.length < 3 || content.hashtags.length > 5) {
    throw new ValidationError(
      `Invalid hashtag count: got ${content.hashtags?.length || 0}. Must be between 3 and 5.`
    );
  }

  const uniqueHashtags = new Set(content.hashtags.map((tag) => tag.toLowerCase().trim()));
  if (uniqueHashtags.size !== content.hashtags.length) {
    throw new ValidationError('Duplicate hashtags detected');
  }

  // 3. Format-specific validations
  if (format === 'carousel') {
    if (!content.slides || content.slides.length < 3 || content.slides.length > 10) {
      throw new ValidationError(
        `Invalid slides count: got ${content.slides?.length || 0}. Must be between 3 and 10.`
      );
    }
    for (let i = 0; i < content.slides.length; i++) {
      const slide = content.slides[i];
      if (!slide?.title || !slide?.content) {
        throw new ValidationError(`Slide at index ${i} is missing title or content`);
      }
    }
  }

  if (format === 'poll') {
    if (!content.pollQuestion || content.pollQuestion.trim().length === 0) {
      throw new ValidationError('Poll question is missing');
    }
    if (!content.pollOptions || content.pollOptions.length < 2 || content.pollOptions.length > 4) {
      throw new ValidationError(
        `Invalid poll options count: got ${content.pollOptions?.length || 0}. Must be between 2 and 4.`
      );
    }
    for (const option of content.pollOptions) {
      if (!option || option.trim().length === 0) {
        throw new ValidationError('Poll option is empty');
      }
    }
  }
}

import type { ContentFormat, Topic } from '@prisma/client';
import { z } from 'zod';
import { getLLMProvider } from '../ai/llm/index.js';
import { buildTextPostPrompt } from '../ai/prompts/text-post.js';
import { validateContent } from './validator.js';
import { ValidationError, LLMProviderError } from '../lib/errors.js';
import { logger } from '../monitoring/logger.js';
import type { GeneratedContent } from './types.js';

// Base content Zod schema
const baseGeneratedSchema = z.object({
  hook: z.string().min(1),
  body: z.string().min(1),
  cta: z.string().min(1),
  hashtags: z.array(z.string()).min(3).max(5),
});

// Carousel content Zod schema
const carouselGeneratedSchema = baseGeneratedSchema.extend({
  slides: z.array(
    z.object({
      title: z.string().min(1),
      content: z.string().min(1),
    })
  ).min(3).max(10),
});

// Poll content Zod schema
const pollGeneratedSchema = baseGeneratedSchema.extend({
  pollQuestion: z.string().min(1),
  pollOptions: z.array(z.string().min(1)).min(2).max(4),
});

/**
 * Builds the LLM prompt based on format.
 */
function buildPrompt(
  format: ContentFormat,
  pillar: string,
  topic: Topic,
  recentHooks: string[],
  voice: string
) {
  let spec;
  if (format === 'text' || format === 'image' || format === 'infographic') {
    spec = buildTextPostPrompt({ pillar, topic, recentHooks, voice });
  } else if (format === 'carousel') {
    const textSpec = buildTextPostPrompt({ pillar, topic, recentHooks, voice });
    const system = `${textSpec.system.replace(
      'Return your response ONLY as a valid JSON object.',
      'Return your response ONLY as a valid JSON object matching the extended carousel schema.'
    )}
    
The JSON schema must include "slides":
{
  "hook": "string",
  "body": "string",
  "cta": "string",
  "hashtags": ["string"],
  "slides": [
    {
      "title": "string (slide title/headline)",
      "content": "string (1-2 sentences of body content for this slide)"
    }
  ] (3-10 slides)
}`;
    spec = { ...textSpec, system };
  } else if (format === 'poll') {
    const textSpec = buildTextPostPrompt({ pillar, topic, recentHooks, voice });
    const system = `${textSpec.system.replace(
      'Return your response ONLY as a valid JSON object.',
      'Return your response ONLY as a valid JSON object matching the extended poll schema.'
    )}
    
The JSON schema must include "pollQuestion" and "pollOptions":
{
  "hook": "string",
  "body": "string",
  "cta": "string",
  "hashtags": ["string"],
  "pollQuestion": "string (max 100 chars, the main poll question)",
  "pollOptions": ["string", "string"] (2-4 options, max 30 chars each)
}`;
    spec = { ...textSpec, system };
  } else {
    throw new ValidationError(`Unsupported content format: ${format}`);
  }

  spec.tier = 'smart';
  return spec;
}

/**
 * Parses and validates raw LLM output against the correct schema.
 */
function parseAndValidate(contentStr: string, format: ContentFormat): GeneratedContent {
  let cleaned = contentStr.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  }

  const rawJson = JSON.parse(cleaned);

  let parsed: GeneratedContent;
  if (format === 'carousel') {
    parsed = carouselGeneratedSchema.parse(rawJson);
  } else if (format === 'poll') {
    parsed = pollGeneratedSchema.parse(rawJson);
  } else {
    parsed = baseGeneratedSchema.parse(rawJson);
  }

  validateContent(parsed, format);
  return parsed;
}

/**
 * Generates and validates content from the LLM, retrying on validation failures.
 */
export async function generateContent(
  pillar: string,
  format: ContentFormat,
  topic: Topic,
  recentHooks: string[] = [],
  voice = 'practical, senior engineer, no fluff'
): Promise<GeneratedContent> {
  const log = logger.child({ module: 'content-generator', pillar, format, topicId: topic.id });
  const llm = getLLMProvider();
  
  const prompt = buildPrompt(format, pillar, topic, recentHooks, voice);
  
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log.info({ attempt, tier: prompt.tier }, 'Generating content from LLM');
      const result = await llm.generate(prompt);
      log.info({ attempt, contentLength: result.content.length }, 'LLM response received, validating');

      const parsed = parseAndValidate(result.content, format);
      log.info('Content successfully generated and validated');
      return parsed;
    } catch (err: any) {
      log.warn({ attempt, err: err.message }, 'Content validation or parsing failed. Retrying.');
      
      if (attempt === maxRetries) {
        throw new LLMProviderError(
          `Failed to generate valid content after ${maxRetries} attempts: ${err.message}`,
          { cause: err }
        );
      }
    }
  }

  throw new LLMProviderError('Content generation failed inexplicably');
}

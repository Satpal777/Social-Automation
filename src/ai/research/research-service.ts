import { z } from 'zod';
import { logger } from '../../monitoring/logger.js';
import { getLLMProvider } from '../llm/index.js';
import { topicRepository } from '../../db/repositories/topic.repository.js';
import type { Topic } from '@prisma/client';

const topicsResponseSchema = z.object({
  topics: z.array(
    z.object({
      title: z.string().min(5),
      summary: z.string().min(10),
      url: z.string().url().optional().nullable(),
    })
  ),
});

export const ResearchService = {
  /**
   * Finds or generates topics for a given content pillar.
   * Checks for existing unused topics in DB, and if none exist, fetches/generates new ones.
   */
  async findTopics(pillar: string): Promise<Topic[]> {
    const log = logger.child({ module: 'research-service', pillar });
    log.info('Looking for unused topics in database');

    // 1. Check if we already have unused topics in DB
    const existingUnused = await topicRepository.findUnused(pillar);
    if (existingUnused.length > 0) {
      log.info({ count: existingUnused.length }, 'Found existing unused topics in database');
      return existingUnused;
    }

    log.info('No unused topics found. Initiating LLM-based topic generation.');

    // 2. Fall back to LLM-based topic generation (optionally call News/Search API in future)
    const llm = getLLMProvider();
    
    // Get recent topics to prevent generating duplicates
    const recentTopics = await topicRepository.findRecentByPillar(pillar, 15);
    const recentTitles = recentTopics.map((t) => t.title);

    const prompt = {
      system: `You are an expert tech researcher.
Identify 5 fresh, trending, or highly educational technical topics/angles for a professional developer audience under the pillar: "${pillar}".
Provide a concise title and a 2-3 sentence summary explaining the practical value of each topic.

Return your response ONLY as a valid JSON object matching the schema:
{
  "topics": [
    {
      "title": "string",
      "summary": "string"
    }
  ]
}

Do not output any markdown formatting, wrappers, or text outside the JSON.`,
      user: `Generate 5 topics for the pillar "${pillar}".
${
  recentTitles.length > 0
    ? `Avoid repeating or generating topics similar to these recent ones:\n${recentTitles
        .map((t) => `- ${t}`)
        .join('\n')}`
    : ''
}`,
      temperature: 0.8,
    };

    try {
      const result = await llm.generate(prompt);
      
      // Clean potential JSON wrappers (e.g. ```json ... ```)
      let cleanedContent = result.content.trim();
      if (cleanedContent.startsWith('```')) {
        cleanedContent = cleanedContent.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
      }

      const parsed = topicsResponseSchema.parse(JSON.parse(cleanedContent));
      const createdTopics: Topic[] = [];

      for (const t of parsed.topics) {
        // Simple title similarity check (exact or close match)
        const isDuplicate = recentTitles.some(
          (recentTitle) =>
            recentTitle.toLowerCase().trim() === t.title.toLowerCase().trim() ||
            recentTitle.toLowerCase().includes(t.title.toLowerCase()) ||
            t.title.toLowerCase().includes(recentTitle.toLowerCase())
        );

        if (isDuplicate) {
          log.debug({ title: t.title }, 'Skipping duplicate topic suggested by LLM');
          continue;
        }

        const newTopic = await topicRepository.create({
          pillar,
          source: 'llm-ideation',
          title: t.title,
          summary: t.summary,
          url: t.url || null,
          raw: t as any,
        });

        createdTopics.push(newTopic);
      }

      log.info({ count: createdTopics.length }, 'Successfully generated and cached new topics');
      return createdTopics;
    } catch (err: any) {
      log.error({ err }, 'Failed to generate topics via LLM');
      // If LLM fails, return empty list or fallback topic
      const fallbackTopic = await topicRepository.create({
        pillar,
        source: 'fallback',
        title: `Practical Insights in ${pillar}`,
        summary: `A deep dive into best practices, design choices, and common patterns in ${pillar}.`,
        url: null,
      });
      return [fallbackTopic];
    }
  },
};

import { z } from 'zod';
import { logger } from '../../monitoring/logger.js';
import { env } from '../../config/env.js';
import { getLLMProvider } from '../llm/index.js';
import { topicRepository } from '../../db/repositories/topic.repository.js';
import { searchTavily, type TavilySearchResult } from './tavily-client.js';
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

/**
 * Natural-language search queries for the pillars used by the default schedule.
 * Phrased to pull live discussion/sentiment from developer social platforms
 * (Reddit, Hacker News, X/Twitter, dev.to) rather than just news-wire articles,
 * so topic ideation reflects what practitioners are actually talking about
 * right now, not just what press releases say.
 */
const PILLAR_SEARCH_QUERIES: Record<string, string> = {
  'ai-technology-updates':
    'latest AI technology news, releases, and trending discussions on Reddit, Hacker News, and X/Twitter this week',
  'software-engineering':
    'software engineering best practices, hot takes, and trending discussions on Reddit, Hacker News, and X/Twitter this week',
  'developer-productivity-tips':
    'developer productivity tools, workflow trends, and trending discussions on Reddit, Hacker News, and X/Twitter this week',
  'industry-insights-startups':
    'tech startup industry news and trending discussions on Reddit, Hacker News, and X/Twitter this week',
};

/**
 * Social/community domains to bias Tavily search toward, so grounding reflects
 * real-time developer chatter rather than only news publishers.
 */
const SOCIAL_SEARCH_DOMAINS = [
  'reddit.com',
  'news.ycombinator.com',
  'twitter.com',
  'x.com',
  'dev.to',
  'lobste.rs',
  'stackoverflow.blog',
  'github.blog',
];

/** Builds a Tavily search query for a pillar, with a generic fallback for custom pillars. */
export function buildSearchQuery(pillar: string): string {
  return (
    PILLAR_SEARCH_QUERIES[pillar] ??
    `latest news and trending discussions in ${pillar.replace(/-/g, ' ')} on Reddit, Hacker News, and X/Twitter this week`
  );
}

/** Formats search results as a numbered block to embed in the LLM prompt. */
function formatGroundingBlock(results: TavilySearchResult[]): string {
  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.content.slice(0, 300)}`)
    .join('\n\n');
}

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

    // 2. Ground ideation in real web search results when Tavily is configured.
    // Prefer live developer-community chatter (Reddit, HN, X/Twitter, dev.to) over
    // generic news wire coverage; broaden to the open web if that comes up thin.
    let searchResults: TavilySearchResult[] = [];
    if (env.SEARCH_API_KEY) {
      try {
        searchResults = await searchTavily(buildSearchQuery(pillar), {
          maxResults: 8,
          includeDomains: SOCIAL_SEARCH_DOMAINS,
          topic: 'general',
          days: 7,
        });
        if (searchResults.length < 3) {
          log.info(
            { socialResultCount: searchResults.length },
            'Social-platform search returned few results — broadening to the open web'
          );
          searchResults = await searchTavily(buildSearchQuery(pillar), { maxResults: 8 });
        }
      } catch (err) {
        log.warn({ err }, 'Tavily search failed — falling back to LLM-only ideation');
      }
    } else {
      log.info('SEARCH_API_KEY not configured — using LLM-only ideation');
    }

    log.info({ searchResultCount: searchResults.length }, 'Initiating LLM-based topic generation');

    const llm = getLLMProvider();

    // Get recent topics to prevent generating duplicates
    const recentTopics = await topicRepository.findRecentByPillar(pillar, 15);
    const recentTitles = recentTopics.map((t) => t.title);

    const groundingBlock = searchResults.length > 0 ? formatGroundingBlock(searchResults) : null;

    const prompt = {
      system: `You are an expert tech researcher.
Identify 5 fresh, trending, or highly educational technical topics/angles for a professional developer audience under the pillar: "${pillar}".
${groundingBlock ? 'You are given real, current web search results below — base your topics on them and include the most relevant source URL per topic. Do not invent facts beyond what the search results support.\n' : ''}Provide a concise title and a 2-3 sentence summary explaining the practical value of each topic.

Return your response ONLY as a valid JSON object matching the schema:
{
  "topics": [
    {
      "title": "string",
      "summary": "string",
      "url": "string (optional — the source URL, only if grounded in a search result)"
    }
  ]
}

Do not output any markdown formatting, wrappers, or text outside the JSON.`,
      user: `Generate 5 topics for the pillar "${pillar}".
${groundingBlock ? `Real, current web search results:\n${groundingBlock}\n\n` : ''}${
  recentTitles.length > 0
    ? `Avoid repeating or generating topics similar to these recent ones:\n${recentTitles
        .map((t) => `- ${t}`)
        .join('\n')}`
    : ''
}`,
      temperature: 0.8,
      tier: 'fast' as const,
    };

    try {
      log.info(
        { tier: prompt.tier, grounded: Boolean(groundingBlock) },
        'Calling LLM provider for topic ideation'
      );
      const result = await llm.generate(prompt);
      log.info({ contentLength: result.content.length }, 'LLM provider returned topic ideation response');

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
          source: groundingBlock ? 'tavily-search' : 'llm-ideation',
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

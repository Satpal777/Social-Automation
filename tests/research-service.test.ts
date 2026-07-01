import { describe, it, expect } from 'vitest';
import { buildSearchQuery } from '../src/ai/research/research-service.js';

describe('buildSearchQuery', () => {
  it('returns a curated query for known pillars', () => {
    expect(buildSearchQuery('ai-technology-updates')).toMatch(/AI technology/i);
    expect(buildSearchQuery('software-engineering')).toMatch(/software engineering/i);
    expect(buildSearchQuery('developer-productivity-tips')).toMatch(/productivity/i);
    expect(buildSearchQuery('industry-insights-startups')).toMatch(/startup/i);
  });

  it('falls back to a generic query for unknown/custom pillars', () => {
    expect(buildSearchQuery('quantum-computing')).toBe(
      'latest news and trending discussions in quantum computing on Reddit, Hacker News, and X/Twitter this week'
    );
  });
});

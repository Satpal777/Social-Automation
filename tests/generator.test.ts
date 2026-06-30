import { describe, it, expect, vi } from 'vitest';
import { buildTextPostPrompt } from '../src/ai/prompts/text-post.js';
import { generateContent } from '../src/content/generator.js';
import { getLLMProvider } from '../src/ai/llm/index.js';
import type { Topic } from '@prisma/client';

// Mock the LLM provider layer
vi.mock('../src/ai/llm/index.js', () => {
  const mockProvider = {
    generate: vi.fn(),
  };
  return {
    getLLMProvider: () => mockProvider,
  };
});

describe('Prompt Template Builder', () => {
  it('should compile correct system and user prompts', () => {
    const context = {
      pillar: 'software-engineering',
      topic: { title: 'Design Patterns', summary: 'Use of factory design pattern.', url: 'https://source.com' },
      recentHooks: ['First hook example', 'Second hook example'],
      voice: 'professional technical engineer',
    };

    const prompt = buildTextPostPrompt(context);
    expect(prompt.system).toContain('professional technical engineer');
    expect(prompt.system).toContain('First hook example');
    expect(prompt.user).toContain('software-engineering');
    expect(prompt.user).toContain('Design Patterns');
  });
});

describe('Content Generator', () => {
  const dummyTopic: Topic = {
    id: 'topic-uuid-1234',
    pillar: 'software-engineering',
    source: 'test-source',
    title: 'Testing in Production',
    summary: 'A deep dive into testing.',
    url: null,
    raw: null,
    usedAt: null,
    fetchedAt: new Date(),
  };

  it('should successfully parse valid JSON response from LLM', async () => {
    const mockProvider = getLLMProvider();
    
    // Simulate valid LLM output
    const mockOutput = JSON.stringify({
      hook: 'Testing in production is fine if you know what you are doing.',
      body: 'Make sure to separate traffic and use feature flags.',
      cta: 'Do you test in production?',
      hashtags: ['#testing', '#devops', '#reliability'],
    });

    vi.mocked(mockProvider.generate).mockResolvedValueOnce({
      content: mockOutput,
      model: 'test-model',
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    const result = await generateContent('software-engineering', 'text', dummyTopic);
    
    expect(result.hook).toBe('Testing in production is fine if you know what you are doing.');
    expect(result.hashtags).toContain('#testing');
  });

  it('should clean markdown JSON fences before parsing', async () => {
    const mockProvider = getLLMProvider();
    
    // Simulate LLM wrapping JSON in markdown code blocks
    const mockOutput = '```json\n' + JSON.stringify({
      hook: 'Clean code vs fast delivery.',
      body: 'Always strike a good balance.',
      cta: 'How do you choose?',
      hashtags: ['#cleanbuild', '#architecture', '#productivity'],
    }) + '\n```';

    vi.mocked(mockProvider.generate).mockResolvedValueOnce({
      content: mockOutput,
      model: 'test-model',
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    const result = await generateContent('software-engineering', 'text', dummyTopic);
    expect(result.hook).toBe('Clean code vs fast delivery.');
  });
});

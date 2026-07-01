import { describe, it, expect } from 'vitest';
import {
  parseGenerateArgs,
  DEFAULT_PILLAR,
  DEFAULT_FORMAT,
} from '../src/review/parse-generate-args.js';

describe('parseGenerateArgs', () => {
  it('returns defaults for empty / undefined input', () => {
    for (const input of [undefined, '', '   ']) {
      const res = parseGenerateArgs(input);
      expect(res).toEqual({ ok: true, pillar: DEFAULT_PILLAR, format: DEFAULT_FORMAT });
    }
  });

  it('treats a lone format token as the format with default pillar', () => {
    const res = parseGenerateArgs('carousel');
    expect(res).toEqual({ ok: true, pillar: DEFAULT_PILLAR, format: 'carousel' });
  });

  it('treats a lone non-format token as the pillar with default format', () => {
    const res = parseGenerateArgs('ai-technology-updates');
    expect(res).toEqual({ ok: true, pillar: 'ai-technology-updates', format: DEFAULT_FORMAT });
  });

  it('parses "pillar format" order', () => {
    const res = parseGenerateArgs('ai-technology-updates image');
    expect(res).toEqual({ ok: true, pillar: 'ai-technology-updates', format: 'image' });
  });

  it('is order-tolerant ("format pillar")', () => {
    const res = parseGenerateArgs('image ai-technology-updates');
    expect(res).toEqual({ ok: true, pillar: 'ai-technology-updates', format: 'image' });
  });

  it('is case-insensitive and trims whitespace', () => {
    const res = parseGenerateArgs('  CAROUSEL   Software-Engineering ');
    expect(res).toEqual({ ok: true, pillar: 'software-engineering', format: 'carousel' });
  });

  it('errors when two formats are given', () => {
    const res = parseGenerateArgs('text image');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/two formats/i);
  });

  it('errors when two non-format tokens are given', () => {
    const res = parseGenerateArgs('foo bar');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/unrecognized/i);
  });
});

import type { ContentFormat } from '@prisma/client';

/** All content formats supported by the generation pipeline. */
export const CONTENT_FORMATS: ContentFormat[] = [
  'text',
  'image',
  'carousel',
  'infographic',
  'poll',
];

/** Pillars used by the default schedule — surfaced as suggestions to the user. */
export const KNOWN_PILLARS = [
  'ai-technology-updates',
  'software-engineering',
  'developer-productivity-tips',
  'industry-insights-startups',
];

export const DEFAULT_PILLAR = 'software-engineering';
export const DEFAULT_FORMAT: ContentFormat = 'text';

export type ParseGenerateArgsResult =
  | { ok: true; pillar: string; format: ContentFormat }
  | { ok: false; error: string };

function isContentFormat(token: string): token is ContentFormat {
  return (CONTENT_FORMATS as string[]).includes(token);
}

/**
 * Parse the argument string of a `/generate` Telegram command into a pillar and
 * format. Arguments are order-tolerant: a token matching a known format is the
 * format; any other token is treated as the pillar. Missing values fall back to
 * {@link DEFAULT_PILLAR} / {@link DEFAULT_FORMAT}.
 *
 * Examples:
 *   ""                              -> { software-engineering, text }
 *   "carousel"                      -> { software-engineering, carousel }
 *   "ai-technology-updates image"   -> { ai-technology-updates, image }
 */
export function parseGenerateArgs(argString: string | undefined): ParseGenerateArgsResult {
  const tokens = (argString ?? '')
    .trim()
    .split(/\s+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);

  let pillar: string | undefined;
  let format: ContentFormat | undefined;

  for (const token of tokens) {
    if (isContentFormat(token)) {
      if (format) {
        return {
          ok: false,
          error: `You specified two formats ("${format}" and "${token}"). Pick one of: ${CONTENT_FORMATS.join(', ')}.`,
        };
      }
      format = token;
    } else {
      if (pillar) {
        return {
          ok: false,
          error: `Unrecognized argument "${token}". Usage: /generate [pillar] [format]. Valid formats: ${CONTENT_FORMATS.join(', ')}.`,
        };
      }
      pillar = token;
    }
  }

  return {
    ok: true,
    pillar: pillar ?? DEFAULT_PILLAR,
    format: format ?? DEFAULT_FORMAT,
  };
}

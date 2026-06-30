import type { ContentFormat, PublishMode } from '@prisma/client';

export interface SlotConfig {
  pillar?: string;
  format?: ContentFormat;
  mode: PublishMode;
  scheduleId?: string;
}

export interface GeneratedContent {
  hook: string;
  body: string;
  cta: string;
  hashtags: string[];
  slides?: Array<{ title: string; content: string }>;
  pollQuestion?: string;
  pollOptions?: string[];
}

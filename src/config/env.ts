import 'dotenv/config';

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Coerce common boolean-like strings to actual booleans. */
const booleanString = z
  .enum(['true', 'false', '1', '0', ''])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

/** Coerce a numeric string to a number. */
const portNumber = z.coerce.number().int().positive();

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const envSchema = z.object({
  // --- Core ----------------------------------------------------------------
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error'])
    .default('info'),
  TZ: z.string().default('UTC'),
  APP_BASE_URL: z.string().url(),
  PORT: portNumber.default(3000),

  // --- Security ------------------------------------------------------------
  SECRET_KEY: z
    .string()
    .min(16, 'SECRET_KEY must be at least 16 characters'),

  // --- Database (PostgreSQL) -----------------------------------------------
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  POSTGRES_USER: z.string().optional(),
  POSTGRES_PASSWORD: z.string().optional(),
  POSTGRES_DB: z.string().optional(),

  // --- LLM providers -------------------------------------------------------
  LLM_PROVIDER: z.enum(['anthropic', 'openai', 'openrouter']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-8'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o'),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('meta-llama/llama-3-8b-instruct:free'),
  LLM_FAST_MODEL: z.string().optional(),
  LLM_SMART_MODEL: z.string().optional(),

  // --- Image generation ----------------------------------------------------
  IMAGE_PROVIDER: z.enum(['openai', 'stability', 'none']).default('none'),
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-1'),
  STABILITY_API_KEY: z.string().optional(),

  // --- Research / trending topics ------------------------------------------
  NEWS_API_KEY: z.string().optional(),
  SEARCH_API_KEY: z.string().optional(),

  // --- LinkedIn (Official API) ---------------------------------------------
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  LINKEDIN_REDIRECT_URI: z.string().optional(),
  LINKEDIN_SCOPES: z.string().default('openid,profile,email,w_member_social'),
  LINKEDIN_API_VERSION: z.string().default('202401'),

  // --- Telegram (review + alerts) ------------------------------------------
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  TELEGRAM_USE_WEBHOOK: booleanString,

  // --- Scheduling / behavior -----------------------------------------------
  DEFAULT_MODE: z.enum(['draft', 'auto', 'silent']).default('draft'),
  DAILY_POST_CRON: z.string().default('0 9 * * *'),
  ASSETS_DIR: z.string().default('./data/assets'),
});

// ---------------------------------------------------------------------------
// Parse & export
// ---------------------------------------------------------------------------

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  ✗ ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    console.error(
      `\n❌ Invalid environment variables:\n${formatted}\n\nPlease check your .env file against .env.example.\n`,
    );

    process.exit(1);
  }

  return result.data;
}

/** Validated environment configuration — safe to use throughout the app. */
export const env: Env = parseEnv();

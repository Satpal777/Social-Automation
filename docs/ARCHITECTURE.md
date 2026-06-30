# Architecture

This document describes the system's components, how data flows between them, and the interface
each module exposes. The guiding principle: **small, single-purpose modules communicating through
well-defined interfaces**, so each can be understood, tested, and changed independently.

## High-level diagram

```
                         ┌─────────────────────────────────────────────┐
                         │          Scheduler (node-cron,                │
                         │           in-process, per slot)              │
                         └───────────────────┬──────────────────────────┘
                                             │ run generate-content(slot)
                                             ▼
   ┌──────────────┐   research   ┌─────────────────────┐   prompts ┌──────────────────┐
   │  Research    │─────────────▶│  Content Pipeline    │──────────▶│   AI Layer       │
   │ (news/web +  │   topics     │   (Orchestrator)     │  copy     │  LLM (Claude)    │
   │  LLM synth)  │◀─────────────│                      │◀──────────│  Image (OpenAI)  │
   └──────────────┘              └─────────┬───────────-┘           └──────────────────┘
                                           │ needs asset?
                                           ▼
                                 ┌─────────────────────┐
                                 │  Asset Generator     │  Puppeteer HTML→PDF/PNG
                                 │ carousel/infographic │  (+ optional AI hero image)
                                 └─────────┬───────────-┘
                                           │ persist (status by mode)
                                           ▼
        ┌────────────┐   draft    ┌─────────────────────┐   publish job   ┌──────────────────┐
        │  Telegram  │◀──────────▶│   PostgreSQL (state) │────────────────▶│ LinkedIn API     │
        │  Review    │ approve/   │  content/assets/logs │   on approve    │ Publisher        │
        │  Bot       │ reject/edit└─────────────────────┘                  │ (text/img/doc)   │
        └────────────┘                                                     └──────────────────┘
                                           ▲                                        │
                                           │ analytics fetch (scheduled)            │ URN/URL
                                           └────────────────────────────────────────┘

  Cross-cutting: pino structured logging · retry+backoff (p-retry) · health checks ·
                 error alerts → Telegram · Fastify web (OAuth callback + webhooks + /health)
```

## Components

### 1. Scheduler (`src/scheduler`)
Drives the system on time. Uses **`node-cron`** (in-process), registering one cron job per enabled
schedule slot (from the `schedules` table). Each fire calls the orchestrator directly with the slot
config: `{ pillar?, format?, mode }`. Pillar/format may be fixed or drawn from a rotation. No
external queue — single-user volume (~1 post/day) runs comfortably in one process.

### 2. Content Pipeline / Orchestrator (`src/content`)
The brain of a single content job. Coordinates, in order:
`Research → Generate → (Assets) → Persist → Route by mode`. Holds no vendor specifics — it calls
interfaces. Returns a persisted `content_item` and triggers the right downstream path.

**Interface:** `runContentJob(slot: SlotConfig): Promise<ContentItem>`

### 3. AI Layer (`src/ai`)
- **`llm/` — `LLMProvider`**
  `generate(prompt: PromptSpec): Promise<LLMResult>` · `embed(text): Promise<number[]>` (for
  uniqueness). Implementations: `ClaudeProvider`, `OpenAIProvider`. Selected by `LLM_PROVIDER`.
- **`image/` — `ImageProvider`**
  `generate(prompt, opts): Promise<ImageBuffer>`. Implementations: `OpenAIImageProvider`,
  `StabilityProvider` (stub). Selected by `IMAGE_PROVIDER`.
- **`research/` — `ResearchService`**
  `findTopics(pillar): Promise<Topic[]>` — pulls trending items from a news/search API, asks the
  LLM to synthesize angles, and **dedupes** against recently-used topics (`topics` table).
- **`prompts/`** — versioned, per-format prompt templates (see `docs/CONTENT_STRATEGY.md`).

### 4. Asset Generator (`src/assets`)
Turns content into visuals using **HTML/CSS templates rendered by Puppeteer**:
- `CarouselRenderer.render(slides): Promise<PdfAsset>` — multi-slide → PDF (LinkedIn document).
- `InfographicRenderer.render(data): Promise<ImageAsset>` — single PNG.
- Optional AI hero image via `ImageProvider`, composited into image-post templates.
Templates live in `templates/`. Output written to `ASSETS_DIR`, recorded in `assets` table.

### 5. LinkedIn Publisher (`src/linkedin`)
- **`oauth.ts`** — 3-legged OAuth, token storage (encrypted), proactive refresh, member-URN fetch.
- **`client.ts`** — thin REST client (sets `LinkedIn-Version`, auth header, handles 429 backoff).
- **`publishers/`** — `publishText`, `publishImage` (register-upload → PUT bytes → post),
  `publishDocument` (carousel PDF). Polls are **not** published — marked `manual_required`.

**Interface:** `publish(contentItem): Promise<{ urn: string; url: string }>`

### 6. Review Service (`src/review`)
Telegram bot (**grammY**). Sends each draft with inline buttons (Approve / Reject / Edit). Receives
callbacks (webhook or long-poll), updates `content_items.status` + writes `review_actions`, and on
Approve **runs the publish step directly** (wrapped in the retry helper). Also delivers
`manual_required` items (polls) with instructions, and receives system **error alerts**.

### 7. Persistence (`src/db`)
PostgreSQL via **Prisma**. Business logic talks to **repositories**, not Prisma directly. Schema in
`docs/DATABASE.md` / `prisma/schema.prisma`.

### 8. Jobs & retries (`src/scheduler`, `src/lib`)
No external queue. Work runs as **in-process async functions** invoked by `node-cron` or by the
Telegram approve callback:
- `runContentJob(slot)` → the orchestrator (research → generate → asset → persist → route).
- `publish(contentItem)` → LinkedIn publish (called inline in Auto mode, or on Approve).
- `fetchAnalytics()` → a daily cron pulling engagement for published posts.

External calls (LLM, image, LinkedIn) are wrapped in a **retry helper** (`p-retry`, in `src/lib`)
with exponential backoff. Publish is **idempotent** (guards on `status` + `dedupe_key`). Final
failures emit a Telegram alert and write a `publish_logs`/error record; failed items can be re-run
manually (a small CLI command), no dead-letter queue needed.

### 9. Web (`src/web`) — Fastify
Minimal HTTP surface (needs HTTPS in prod via Caddy):
- `GET /auth/linkedin` → redirect to LinkedIn login.
- `GET /auth/linkedin/callback` → exchange code, store tokens.
- `POST /telegram/webhook` → Telegram updates (if webhook mode).
- `GET /health` → checks DB + token validity.

### 10. Monitoring (`src/monitoring`)
`pino` logger (correlation id per job), alert helper (→ Telegram), and health checks.

## Data flow (one daily post, Draft mode)

1. Scheduler fires slot → orchestrator runs `runContentJob(slot)`.
2. Orchestrator: `ResearchService.findTopics(pillar)` → pick fresh topic.
3. `LLMProvider.generate(prompt)` → post copy (hook/body/cta/hashtags); validate + uniqueness.
4. If format needs visuals → Asset Generator renders PDF/PNG.
5. Persist `content_item` (`status=pending_review`) + `assets`.
6. Review Service sends draft to Telegram.
7. User taps **Approve** → `publish(contentItem)` runs directly.
8. Publisher posts via LinkedIn API → store `linkedin_urn` / `linkedin_url`, `status=published`.
9. Later, `fetch-analytics` records engagement.

## Boot sequence (`src/index.ts`)
Validate env → connect DB → start Fastify (web) → register `node-cron` jobs from `schedules` →
ready. Everything runs in a **single process**. If volume ever grows, a queue (BullMQ/Redis) and a
separate worker process can be reintroduced without changing the core modules (they're already
behind interfaces) — explicitly out of scope for personal use.

## Module dependency rules
- Business logic depends on **interfaces**, never vendor SDKs.
- `src/db` repositories are the only place that imports the Prisma client.
- `src/linkedin`, `src/ai`, `src/assets`, `src/review` know nothing about each other — the
  orchestrator wires them together.

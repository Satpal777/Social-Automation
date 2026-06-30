# CLAUDE.md — Guidance for Claude / agents working in this repo

This file orients any Claude Code session (or other agent) picking up this project. Read it
first, then the doc referenced by whatever phase you're on in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## What this project is

An **AI-powered LinkedIn content automation system**: it researches trending tech topics,
generates daily multi-format LinkedIn posts, optionally routes them through Telegram review, and
publishes via the **official LinkedIn API**. Full rationale in [`README.md`](README.md).

## Current state

- **Docs/specs:** complete (this directory).
- **Code:** not yet started. Build strictly in the phase order of [`docs/ROADMAP.md`](docs/ROADMAP.md).
- Treat the docs as the source of truth. If you change a decision, update the relevant doc in the
  same change so docs never drift from code.

## Non-negotiable decisions (do not silently reverse)

1. **Official LinkedIn API only.** No browser automation / scraping / unofficial endpoints. This
   is a compliance-first decision. Polls and any unsupported formats are produced as
   `manual_required` content delivered to Telegram for manual posting — never auto-posted.
2. **TypeScript / Node.js 20+, ESM.** One language across the system.
3. **Pluggable AI providers.** All LLM and image calls go through interfaces
   (`LLMProvider`, `ImageProvider`) — never call a vendor SDK directly from business logic.
4. **Secrets/tokens encrypted at rest** and never logged.
5. **Idempotent publishing.** A retry must never double-post (guard via content status + dedupe key).

If a change seems to require breaking one of these, stop and confirm with the user first.

## Architecture in one breath

`Scheduler (node-cron, in-process) → Orchestrator → [Research → LLM generate → Asset render] →
persist (Postgres) → route by mode (Draft→Telegram / Auto→publish / Silent→notify) → LinkedIn API
publisher → analytics`. Cross-cutting: pino logging, retry+backoff (p-retry), Telegram alerts,
Fastify web (OAuth callback + Telegram webhook + `/health`). No external queue/Redis — single-user,
~1 post/day runs in one process. Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Intended project layout (create as you implement)

```
src/
  config/     ai/llm/   ai/image/  ai/research/  ai/prompts/
  content/    assets/    linkedin/  review/       scheduler/   lib/
  analytics/  web/       monitoring/ db/          index.ts
prisma/   templates/   docker/   tests/
```
Keep modules **small and single-purpose**, communicating through clear interfaces. A growing file
is a signal to split. Every module should answer: what it does, how to use it, what it depends on.

## Conventions

- **Language:** TypeScript, ESM (`"type": "module"`), Node 20+.
- **Validation:** `zod` for env + all external inputs (LLM output, webhooks, API responses).
- **Config:** validated env schema at boot (`src/config`); fail fast on missing/invalid vars.
- **Errors:** typed errors; never swallow; log with context + correlation id.
- **Logging:** `pino` structured logs. Never log secrets/tokens/PII.
- **DB access:** through repositories in `src/db`, not raw Prisma calls scattered in business logic.
- **Tests:** `vitest`. Unit-test generators, validation, dedupe, and LinkedIn request-builders.
- **Pipeline steps:** publish must be **idempotent** (guard via `status` + `dedupe_key`); wrap external calls (LLM, image, LinkedIn) in a retry-with-backoff helper (`p-retry`, in `src/lib`).

## Commands (define in package.json as you scaffold)

```bash
npm run dev            # run web + in-process scheduler (watch mode)
npm start              # production start
npm run db:migrate     # prisma migrate
npm run db:studio      # prisma studio
npm run linkedin:auth  # one-time OAuth flow
npm test               # vitest
npm run lint           # eslint
docker compose up -d   # postgres (+ app/caddy in prod)
```

## How to continue work (every session)

1. Open [`docs/ROADMAP.md`](docs/ROADMAP.md), find the first unchecked phase/task.
2. Read the doc(s) that phase references.
3. Implement the smallest verifiable slice; follow the phase's **Verify** steps before checking it off.
4. Update docs if behavior/decisions changed.
5. Prefer reusing existing modules/utilities over adding new ones.

## Working agreements

- Don't add features beyond the current phase (YAGNI). Deferred items are listed in the roadmap.
- Don't introduce a web admin dashboard or browser automation — explicitly out of scope for v1.
- Confirm before outward-facing or hard-to-reverse actions (publishing live posts, deleting data).

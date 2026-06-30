# Implementation Roadmap

Build in phase order. Each phase is **independently verifiable** — complete its **Verify** steps
before checking it off. Agents: pick the first unchecked item, read the referenced docs, implement
the smallest slice, verify, then check it off. Keep docs in sync with any decision changes.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done.

---

## Phase 0 — Foundation & docs
- [x] Write design docs (`README.md`, `CLAUDE.md`, `docs/*`, `.env.example`). ← **done**
- [ ] Scaffold repo: `package.json` (ESM), `tsconfig`, eslint, `vitest`, folder layout from ARCHITECTURE.
- [ ] `docker-compose.yml` for `postgres` (dev). (No Redis — in-process scheduler.)
- [ ] `prisma/schema.prisma` matching `docs/DATABASE.md`; first migration.
- [ ] `src/config` — zod env schema (fail fast); `src/monitoring` — pino logger.
- [ ] `src/web` — Fastify with `GET /health` (DB + token check).
- [ ] `git init`, `.gitignore` (`.env`, `node_modules`, `data/`), initial commit.

**Verify:** `docker compose up -d` → DB/Redis healthy · `npm run db:migrate` applies · `npm run dev`
boots · `GET /health` → `200`.

---

## Phase 1 — LinkedIn auth + text publish
> Start the LinkedIn **product approval** now (see `docs/LINKEDIN_INTEGRATION.md`) — it gates publish.
- [ ] `src/linkedin/oauth.ts` — authorize redirect, callback token exchange, encrypted storage.
- [ ] Member URN fetch (`/v2/userinfo`) → store `member_urn`.
- [ ] Proactive token refresh + `/health` token check.
- [ ] `src/linkedin/client.ts` — REST client (version header, auth, 429 backoff).
- [ ] `src/linkedin/publishers/text.ts` — publish a text post.
- [ ] `npm run linkedin:auth` helper + a manual "publish test post" command.

**Verify:** complete OAuth end-to-end · tokens stored encrypted · publish one real text post ·
`linkedin_urn`/`linkedin_url` saved · `publish_logs` recorded. *(If approval pending, verify request
construction + token flow against a sandbox/manual run.)*

---

## Phase 2 — AI content generation (text)
- [ ] `src/ai/llm` — `LLMProvider` interface + `ClaudeProvider` + `OpenAIProvider`; selected by env.
- [ ] `src/ai/research` — `ResearchService.findTopics(pillar)` + dedupe vs `topics`.
- [ ] `src/ai/prompts` — text-post template returning validated JSON (hook/body/cta/hashtags).
- [ ] `src/content` — generate step: validation + uniqueness (embedding/shingle) gates.
- [ ] Persist `content_items` with `generation_meta`.

**Verify:** running the generator stores a clean, unique, on-pillar text post with metadata ·
`vitest` covers validation + dedupe + provider selection.

---

## Phase 3 — Pipeline + queue + Draft mode + Telegram
- [ ] `src/queue` — BullMQ setup, `generate`/`publish` workers (idempotent + backoff).
- [ ] Scheduler: repeatable jobs from `schedules`; `generate-content(slot)` enqueue.
- [ ] `src/content` orchestrator wiring research → generate → persist → route-by-mode.
- [ ] `src/review` — grammY Telegram bot: send draft with Approve/Reject/Edit; handle callbacks.
- [ ] Implement Draft / Auto / Silent routing; Approve → enqueue `publish`.

**Verify:** a scheduled slot produces a draft · Telegram delivers it · **Approve** publishes
end-to-end · Reject/Edit update `content_items.status` + write `review_actions` · Auto publishes
without a gate · Silent notifies only.

---

## Phase 4 — Visual assets
- [ ] `templates/` — HTML/CSS for carousel slides + infographic.
- [ ] `src/assets` — `CarouselRenderer` (→ PDF) + `InfographicRenderer` (→ PNG) via Puppeteer.
- [ ] `src/ai/image` — `ImageProvider` + `OpenAIImageProvider` (optional hero images).
- [ ] `src/linkedin/publishers/` — `image.ts` (init→PUT→post) + `document.ts` (carousel PDF).
- [ ] Wire asset step into the orchestrator for `image`/`carousel`/`infographic`.

**Verify:** generate a carousel PDF and an image post · publish both via API · `assets` rows stored
and linked to the `content_item`.

---

## Phase 5 — Polls + remaining formats
- [ ] Poll generation → `status=manual_required`; never auto-published.
- [ ] Telegram delivery of polls with manual-posting instructions.
- [ ] Any remaining format polish; format rotation in schedules.

**Verify:** a poll is generated, delivered to Telegram with correct instructions, and never hits the
publish path.

---

## Phase 6 — Analytics, monitoring, hardening
- [ ] `src/analytics` — `fetch-analytics` scheduled job → write `analytics` rows.
- [ ] Retry/backoff audit across all workers; dead-letter / re-enqueue path.
- [ ] Deepen `/health`; failure + token-refresh alerts to Telegram.
- [ ] `pg_dump` backup job; verify token/secret encryption at rest.

**Verify:** forced publish failure → retried then alerted · analytics row written for a published
post · backup produces a restorable dump.

---

## Phase 7 — Deploy
- [ ] Provision VPS; domain + DNS.
- [ ] Add `caddy` service + `Caddyfile` (TLS); production `docker-compose`.
- [ ] Server `.env` with real domain (`APP_BASE_URL`, `LINKEDIN_REDIRECT_URI`); secrets set.
- [ ] `docker compose up -d`; migrate; complete OAuth on prod; set Telegram webhook (if used).
- [ ] Smoke-test full pipeline; go live at 1/day Draft mode.

**Verify:** a live scheduled run delivers a draft to Telegram in production · Approve → published ·
`/health` green.

---

## Overall acceptance (end-to-end)
1. `docker compose up` → services healthy, migrations applied, `/health` ok.
2. LinkedIn OAuth complete → tokens encrypted, member URN resolved.
3. Draft-mode slot → content generated, asset rendered, draft to Telegram w/ buttons.
4. Approve → published via API; status `published`, URN/URL stored.
5. Auto → publishes without gate; Silent → notifies only.
6. Poll → `manual_required`, instructions sent, never auto-published.
7. Forced publish failure → retried then alerted; `publish_logs` recorded.
8. Analytics job → engagement row for a published post.
9. `vitest` green for generators, validation, dedupe, publisher request-building.

## Deferred (YAGNI for v1)
- Web admin dashboard (Telegram covers review).
- Browser-automation module for polls/auto (explicitly out — compliance-first).
- Multi-account / team support; A/B testing of hooks; comment auto-replies.

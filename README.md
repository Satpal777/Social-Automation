# AI-Powered LinkedIn Content Automation System

An autonomous system that **researches trending topics, generates high-quality LinkedIn content
daily in multiple formats, and publishes it** (with review controls) on a configurable schedule —
running unattended on a cloud server.

> **Status:** 📐 Design & documentation complete. Implementation not started.
> This repository currently contains the **plan and specification docs**. Code is built in phases
> per [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Why this exists

LinkedIn growth and engagement decline without consistent posting. Manually producing daily,
on-brand, multi-format content is unsustainable. This system automates the full loop:
**research → generate → (optional review) → publish → measure**, so a consistent presence is
maintained with minimal human effort.

## What it does

- Generates **1 high-quality post per day** (configurable to multiple/day).
- Produces multiple formats: **text, image, carousel (PDF/document), infographic, poll**.
- Researches **trending topics** across AI, software engineering, developer productivity,
  startups, and industry news.
- Routes each post through one of three **publishing modes**:
  - **Draft** (default) — review & approve via Telegram before publishing.
  - **Auto** — publish automatically at the scheduled time.
  - **Silent** — generate & store, notify only, never publish.
- Tracks all content, assets, publish logs, and engagement analytics in PostgreSQL.

---

## Locked architecture decisions

| Area | Decision | Why |
|------|----------|-----|
| LinkedIn publishing | **Official API only** (compliance-first) | Lowest account-ban risk, sustainable long-term. Polls & unsupported formats are *drafted for manual posting*. |
| Backend stack | **TypeScript / Node.js 20+** (ESM) | One language end-to-end; best tooling for LinkedIn API, Puppeteer, scheduling. |
| Hosting | **Single VPS + Docker Compose** | `app` + `postgres` + `caddy`; ~$5–10/mo; full control. |
| Job model | **In-process (no queue)** | Single-user, ~1 post/day — `node-cron` runs the pipeline directly; no Redis/BullMQ. |
| Review / notify | **Telegram bot** | Mobile-friendly Approve / Reject / Edit per post. |
| LLM provider | **Pluggable (both)** | Claude for writing, OpenAI for images, behind interfaces. |
| Visual assets | **Hybrid** | Template-based (Puppeteer HTML→PDF/PNG) for carousels/infographics; optional AI hero images. |
| Cadence / mode | **1/day, Draft default** | All 3 modes configurable per schedule slot. |

> ⚠️ **Important constraint:** Publishing to a **personal** profile via the official API requires
> the `w_member_social` scope under LinkedIn's *"Share on LinkedIn" / Community Management*
> product, which needs a LinkedIn Developer App and **product-access approval**. Start this
> approval process on day one. Until approved, run in **Silent/Draft** mode (content + assets are
> produced for copy-paste). See [`docs/LINKEDIN_INTEGRATION.md`](docs/LINKEDIN_INTEGRATION.md).

---

## Documentation map

| Doc | What's inside |
|-----|---------------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Components, data flow, module interfaces. |
| [`docs/WORKFLOW.md`](docs/WORKFLOW.md) | The daily pipeline, publishing modes, quality gates. |
| [`docs/DATABASE.md`](docs/DATABASE.md) | Full schema, tables, enums, relationships. |
| [`docs/LINKEDIN_INTEGRATION.md`](docs/LINKEDIN_INTEGRATION.md) | OAuth, scopes, app review, endpoints per post type. |
| [`docs/CONTENT_STRATEGY.md`](docs/CONTENT_STRATEGY.md) | Pillars, formats, prompt templates, quality policy. |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | VPS + Docker + Caddy TLS, secrets, backups, CI. |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Monitoring, logging, retries, alerts, runbooks. |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Phases 0–7 with per-phase verification checklists. |
| [`CLAUDE.md`](CLAUDE.md) | Guidance for Claude/agents continuing this work. |
| [`.env.example`](.env.example) | Every required environment variable, documented. |

---

## Quickstart (once implemented — see ROADMAP for current phase)

```bash
# 1. Configure environment
cp .env.example .env          # fill in API keys, DB, Telegram, secrets

# 2. Start infrastructure
docker compose up -d          # postgres (and app/caddy in prod)

# 3. Apply database schema
npm run db:migrate

# 4. Authenticate LinkedIn (one-time OAuth)
npm run linkedin:auth         # opens login URL, stores tokens

# 5. Run the service (web + in-process scheduler)
npm run dev                   # or: npm start
```

## Tech stack (summary)

Node.js 20+ · TypeScript (ESM) · Fastify · node-cron (in-process scheduler) · PostgreSQL + Prisma ·
`@anthropic-ai/sdk` + `openai` · Puppeteer · grammY (Telegram) · zod · pino · p-retry · vitest ·
Docker Compose + Caddy.

## License

Private project. Not for redistribution.

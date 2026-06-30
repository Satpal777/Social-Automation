# Workflow

How a post travels from a scheduled trigger to a published (or drafted) LinkedIn post.

## The daily pipeline

```
Scheduler fires slot
        │
        ▼
1. RESEARCH ── pick pillar+format from slot/rotation
        │      fetch trending topics (news/search API)
        │      LLM synthesizes angles · dedupe vs recent topics
        ▼
2. GENERATE ── format-specific prompt → hook + body + CTA + hashtags
        │      validate (length/format) · uniqueness check vs recent posts
        ▼
3. ASSETS ──── (only if format needs visuals)
        │      carousel PDF / infographic via Puppeteer templates
        │      optional AI hero image
        ▼
4. PERSIST ─── store content_item + assets
        │      status set by mode (see below)
        ▼
5. ROUTE BY MODE
        ├── Draft  → send to Telegram for approval
        ├── Auto   → publish immediately (cron fired at the post time)
        └── Silent → notify via Telegram, do not publish
        ▼
6. PUBLISH ──- LinkedIn API → store URN + URL
        │      on failure: retry w/ backoff → alert on final failure
        ▼
7. ANALYTICS - (separate scheduled job) fetch engagement → store
```

## Step detail

### 1. Research
- Input: `slot` (pillar may be fixed or from a rotation; format likewise).
- `ResearchService.findTopics(pillar)` pulls trending items from the configured news/search API.
- The LLM synthesizes candidate **angles** and the service **dedupes** against `topics.used_at`
  history so the same story isn't reused. The chosen topic is recorded.
- If research APIs are unavailable, fall back to LLM-only ideation seeded by the pillar.

### 2. Generate
- A **per-format prompt template** (`src/ai/prompts`, see `docs/CONTENT_STRATEGY.md`) produces the
  post: **hook**, **body**, **CTA**, **hashtags**, and any format-specific fields (e.g. carousel
  slide list, poll question/options).
- **Validation:** enforce per-format length and structure (e.g. text post ≤ ~3000 chars, hook in
  first ~140 chars, hashtag count policy).
- **Uniqueness:** compute an embedding (or shingle hash) and compare to recent posts; regenerate or
  flag if too similar.

### 3. Assets (conditional)
- `text` / `poll` → no asset.
- `image` → optional AI hero image + branded template → PNG.
- `carousel` → multi-slide HTML template → **PDF** (LinkedIn document upload).
- `infographic` → data-driven HTML template → PNG.
- Files written to `ASSETS_DIR`; rows added to `assets`.

### 4. Persist
- Insert `content_item` with all fields + link `assets`.
- Initial `status` depends on mode:

| Mode | Initial status | Then |
|------|----------------|------|
| Draft | `pending_review` | wait for Telegram approval |
| Auto | `approved` | publish immediately (cron fired at the post time) |
| Silent | `generated` | notify only; never publish |

- `poll` format always becomes `manual_required` regardless of mode (API can't post polls).

### 5. Route by mode

**Draft (default).** Review Service sends the rendered draft (text + any asset preview) to Telegram
with inline buttons:
- **Approve** → status `approved`, the publish step runs directly (in-process, with retry).
- **Reject** → status `rejected` (optionally log reason); nothing posted.
- **Edit** → user sends revised text; status stays `pending_review` with updated body, re-sent for
  approval.

**Auto.** No human gate. The orchestrator publishes immediately after generation (the cron already
fired at the intended post time).

**Silent.** Telegram receives a "generated, not publishing" notice with the content for reference.

### 6. Publish
- The publish step calls the right LinkedIn publisher for the format.
- **Idempotency:** it checks `status` and a dedupe key before posting so a retry (or a double
  Approve tap) never double-posts. On success: store `linkedin_urn`, `linkedin_url`,
  `status=published`, `published_at`. Every attempt is written to `publish_logs`.
- **Failure:** retry with exponential backoff (in-process `p-retry` helper). On final failure:
  `status=failed` + Telegram alert with the error; the item can be re-run manually.

### 7. Analytics
- A separate scheduled job (`fetch-analytics`) periodically pulls engagement metrics for published
  posts (where the granted API scope allows) and writes `analytics` rows for trend tracking.

## Publishing modes — summary

| Mode | Human approval? | Publishes? | Use when |
|------|-----------------|-----------|----------|
| **Draft** | Yes (Telegram) | After approve | Default; you want a final check. |
| **Auto** | No | Yes, at schedule | You trust the pipeline / high cadence. |
| **Silent** | No | Never | Building a backlog; pre-approval period. |

Mode is configured **per schedule slot** (`schedules.mode`), so different slots can behave
differently (e.g. weekday Auto, weekend Draft).

## Quality gates (applied in step 2)
- **Length/format** validation per format.
- **Hashtag policy** (count + relevance; see `docs/CONTENT_STRATEGY.md`).
- **Uniqueness** vs recent posts (embedding/shingle similarity threshold).
- **Safety/brand** check: no disallowed claims, on-pillar, professional tone.
Failing a gate triggers a bounded regenerate; persistent failure flags the item for review instead
of publishing.

## Poll special-case
Polls can't be created via the official API for personal profiles. The system still **generates**
the poll (question + options + framing), stores it as `manual_required`, and Telegram delivers it
with step-by-step manual-posting instructions. It is never auto-published.

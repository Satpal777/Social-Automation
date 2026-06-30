# Database Schema

PostgreSQL, accessed via **Prisma** (`prisma/schema.prisma`). Business logic uses repositories in
`src/db` — never raw Prisma calls scattered across modules. All timestamps are `timestamptz`
(UTC). Secret/token columns are **encrypted at the application layer** (AES via `SECRET_KEY`) before
storage and never logged.

## Entity relationships

```
schedules ──(fires)──▶ content_items ──1:N──▶ assets
                              │
                              ├──1:N──▶ publish_logs
                              ├──1:N──▶ analytics
                              └──1:N──▶ review_actions
topics ──(source_topic_id)──▶ content_items
oauth_tokens   (standalone; one active row per provider)
prompt_templates (optional; referenced by format/version)
```

## Enums

```
ContentStatus = generated | pending_review | approved | scheduled
              | publishing | published | failed | rejected | manual_required
ContentFormat = text | image | carousel | infographic | poll
PublishMode   = draft | auto | silent
AssetType     = image | pdf | infographic
ReviewAction  = approve | reject | edit
```

## Tables

### content_items
The central record — one generated piece of content.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| pillar | text | content pillar (see CONTENT_STRATEGY) |
| format | ContentFormat | |
| status | ContentStatus | drives the workflow |
| mode | PublishMode | from the schedule slot |
| title | text null | internal label / article title |
| hook | text | first-line attention grabber |
| body | text | main post copy |
| hashtags | text[] | normalized, leading `#` optional |
| cta | text null | call to action |
| language | text | default `en` |
| scheduled_at | timestamptz null | when to publish (Auto) |
| published_at | timestamptz null | set on success |
| linkedin_urn | text null | e.g. `urn:li:share:...` |
| linkedin_url | text null | public post URL |
| source_topic_id | uuid null FK→topics | provenance |
| generation_meta | jsonb | model, prompt version, tokens, scores |
| dedupe_key | text null | guards against double-publish |
| created_at / updated_at | timestamptz | |

Indexes: `(status)`, `(scheduled_at)`, `(pillar, created_at)`, unique `(dedupe_key)`.

### assets
Rendered visual files attached to a content item.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| content_item_id | uuid FK→content_items | |
| type | AssetType | |
| path | text | path under `ASSETS_DIR` (or object-store URL) |
| mime | text | `image/png`, `application/pdf` |
| width / height | int null | |
| meta | jsonb | slide count, template id, etc. |
| created_at | timestamptz | |

### topics
Research cache + dedupe source for trending topics.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| pillar | text | |
| source | text | api/provider name |
| title | text | |
| url | text null | |
| raw | jsonb | original payload |
| summary | text null | LLM-synthesized angle |
| used_at | timestamptz null | set when turned into content (dedupe) |
| fetched_at | timestamptz | |

Index: `(pillar, fetched_at)`, `(used_at)`.

### schedules
Configurable posting slots that drive the scheduler.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text | e.g. "weekday-morning" |
| cron | text | e.g. `0 9 * * 1-5` |
| timezone | text | IANA tz |
| pillar_rotation | jsonb | ordered pillars to cycle |
| format_rotation | jsonb | ordered formats to cycle |
| mode | PublishMode | draft/auto/silent for this slot |
| enabled | boolean | |
| created_at / updated_at | timestamptz | |

### publish_logs
One row per publish attempt (audit + debugging).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| content_item_id | uuid FK | |
| attempt | int | 1-based |
| status | text | success / failure |
| request | jsonb | sanitized request (no tokens) |
| response | jsonb | API response / error body |
| error | text null | |
| created_at | timestamptz | |

### analytics
Engagement snapshots for published posts.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| content_item_id | uuid FK | |
| impressions / likes / comments / shares / clicks | int | nullable per scope |
| fetched_at | timestamptz | |

Index: `(content_item_id, fetched_at)`.

### oauth_tokens
LinkedIn (and future providers') OAuth credentials. **Encrypted at rest.**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| provider | text | `linkedin` |
| access_token | text (enc) | |
| refresh_token | text (enc) null | |
| expires_at | timestamptz | refresh proactively before this |
| scope | text | granted scopes |
| member_urn | text null | `urn:li:person:...` (author) |
| created_at / updated_at | timestamptz | |

Constraint: one active row per `provider` (upsert on refresh).

### review_actions
Audit of human decisions from Telegram.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| content_item_id | uuid FK | |
| channel | text | `telegram` |
| action | ReviewAction | |
| actor | text | telegram user id |
| payload | jsonb | edited text, reason, etc. |
| created_at | timestamptz | |

### prompt_templates (optional)
Versioned prompt storage if you prefer DB over files.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| format | ContentFormat | |
| version | int | |
| template | text | the prompt body |
| active | boolean | one active per format |

## Notes
- Prefer **soft transitions** via `status` over deleting rows — keeps history/analytics intact.
- `dedupe_key` (e.g. hash of normalized body or `content_item_id`) is the publish idempotency guard.
- Generated assets may live on a Docker volume (`ASSETS_DIR`) for v1; switch to S3-compatible
  object storage later by changing only the asset repository + `path`/URL handling.

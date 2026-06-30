# Operations

Running the system reliably: monitoring, logging, retries, alerts, health, and runbooks.

## Logging
- **`pino`** structured JSON logs (`pino-pretty` in dev).
- Every content job carries a **correlation id** propagated through research → generate → asset →
  persist → publish, so one post's lifecycle is greppable.
- **Never log** secrets, tokens, full API auth headers, or PII. `publish_logs.request` must be
  sanitized.
- Log levels via `LOG_LEVEL`. Use `info` for lifecycle milestones, `warn` for recoverable issues,
  `error` for failures that alert.

## Health checks
`GET /health` returns `200` only when:
- Postgres reachable (simple query),
- LinkedIn token present and not expired (or refreshable).
Use it for uptime monitoring (e.g. a free external pinger) and as a Docker healthcheck.

## Pipeline reliability (in-process, no queue)
- The pipeline runs as in-process async functions (`node-cron` triggers; Telegram approve triggers
  publish). No external queue.
- **Idempotency:** publish guards on `content_items.status` + `dedupe_key` so a retry or a double
  Approve tap never double-posts.
- **Retry policy:** wrap external calls (LLM, image, LinkedIn) in a retry helper (`p-retry`) with
  exponential backoff (e.g. 3–5 attempts).
- **Final failure:** mark the record (`status=failed`, write `publish_logs`) and **alert** to
  Telegram with the error summary + content id.
- **Recovery:** a small CLI command re-runs a failed item by id (replaces a dead-letter queue).

## Alerts (→ Telegram)
Send an alert when:
- A publish fails after all retries.
- OAuth token refresh fails (re-auth needed).
- Research/LLM/image provider errors persist (e.g. quota exhausted).
- `/health` dependency is down (if you add a self-check job).
Alerts include: what failed, content id (if any), error, and the suggested action.

## Token lifecycle runbook
- A scheduled job refreshes the LinkedIn token before `expires_at`.
- **If refresh fails:** alert fires → operator visits `https://<domain>/auth/linkedin` to re-auth.
- Rotating `SECRET_KEY` invalidates stored encrypted tokens → re-auth required.

## Common runbooks

**A post failed to publish.**
1. Check the Telegram alert for the content id + error.
2. Inspect `publish_logs` for that `content_item_id` (sanitized request/response).
3. If transient (429/5xx) → re-run publish for that item. If auth → re-auth. If content-rejected →
   fix content / mark rejected.

**No drafts arriving in Telegram.**
1. `GET /health` — DB/token green?
2. Is the schedule slot `enabled` and its cron correct (timezone!)?
3. Is the scheduler running (logs show the cron jobs registered at boot)?
4. Telegram: bot token valid, chat id correct, webhook set (if webhook mode)?

**LLM/image provider erroring.**
1. Check quota/billing + key validity.
2. Failover: switch `LLM_PROVIDER` / `IMAGE_PROVIDER` (pluggable) and restart.

**Duplicate or near-duplicate content.**
1. Verify the uniqueness gate threshold.
2. Check `topics.used_at` dedupe is being set when a topic is consumed.

## Backups & recovery
- Nightly `pg_dump` (see DEPLOYMENT). Test a restore periodically.
- Assets on the `assets_data` volume; ensure it's included in backups or moved to object storage.

## Metrics worth watching (lightweight)
- Posts generated vs published vs failed per day.
- Approval latency (Draft mode).
- Engagement trend from `analytics` (impressions/likes/comments over time).
- Provider error rate / token refresh outcomes.

## Security hygiene
- Secrets only in `.env`/Docker secrets on the server; never in the image or git.
- Tokens encrypted at rest; never logged.
- Principle of least privilege on the LinkedIn app scopes.
- Validate **all** external inputs with zod (LLM output, webhooks, API responses) before use.
- Keep the OAuth `state` CSRF check on the callback.

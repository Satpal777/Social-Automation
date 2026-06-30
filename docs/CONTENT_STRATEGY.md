# Content Strategy

Defines **what** the system writes and **how** it keeps quality high. The orchestrator and prompt
templates (`src/ai/prompts`) implement this. All of it is configuration-driven so it can evolve
without code changes.

## Content pillars

A rotating set of themes the audience expects. Configurable in `src/config`.

1. **AI & technology updates** — notable model/tool releases, capabilities, practical implications.
2. **Software engineering** — patterns, architecture, code quality, lessons learned.
3. **Developer productivity tips** — workflows, tooling, automation, time-savers.
4. **Industry insights / startups** — trends, market shifts, build-in-public takes.
5. **Trending tech topics** — timely discussion tied to current news.

Pillars cycle via `schedules.pillar_rotation` so the feed stays varied.

## Formats

| Format | Asset | Notes |
|--------|-------|-------|
| `text` | none | The workhorse. Strong hook + scannable body + CTA. |
| `image` | PNG | Text post + branded hero image (template, optional AI image). |
| `carousel` | PDF | Multi-slide document; high reach format. |
| `infographic` | PNG | Single dense visual (data/checklist/comparison). |
| `poll` | none | Generated but `manual_required` (API limitation). |

Formats cycle via `schedules.format_rotation`. Default daily slot favors `text`, with
`carousel`/`image` interspersed weekly.

## Anatomy of a post (what the LLM must return)

- **Hook** — first ~140 chars; earns the "see more" click. No clickbait; concrete value.
- **Body** — short paragraphs / line breaks, scannable; one core idea; optional list.
- **CTA** — a question or invitation to engage (drives comments).
- **Hashtags** — 3–5, relevant, mix of broad + niche; normalized.
- **Format extras** — carousel → ordered slide list (title + 1–2 lines each); poll → question +
  2–4 options.

## Prompt templates (`src/ai/prompts`)

One versioned template per format. Each template receives a structured context and must return
**structured JSON** (validated with zod), e.g.:

```jsonc
// input context
{
  "pillar": "developer-productivity",
  "format": "text",
  "topic": { "title": "...", "summary": "...", "url": "..." },
  "recentHooks": ["...", "..."],     // to avoid repetition
  "voice": "practical, senior engineer, no fluff"
}
// expected output
{
  "hook": "...",
  "body": "...",
  "cta": "...",
  "hashtags": ["#ai", "#softwareengineering"],
  "slides": null            // array for carousel; question/options for poll
}
```

Template guidelines baked into the system prompt:
- Write for a **professional developer/tech audience**; credible, specific, no hype.
- Lead with value; avoid generic intros ("In today's fast-paced world…").
- Use plain language; short lines; whitespace for scannability.
- No fabricated stats or quotes; if citing a trend, keep it verifiable/general.
- Stay on-pillar and on-topic; one idea per post.

## Quality gates (enforced in the generate step)

1. **Length/format** — per-format limits (e.g. text body ≤ ~3000 chars, hook ≤ ~140, carousel
   3–10 slides, poll 2–4 options).
2. **Hashtag policy** — 3–5, deduped, relevant; reject walls of hashtags.
3. **Uniqueness** — embedding (or shingle) similarity vs recent posts below a threshold; otherwise
   regenerate (bounded retries) or flag for review.
4. **Brand/safety** — professional tone; no disallowed claims; on-pillar.

A failing gate triggers a bounded regenerate; persistent failure flags the item for human review
rather than publishing.

## Voice & brand
- Default voice: **practical, senior, generous with insight, lightly opinionated.**
- Configurable via a `voice` string in config so it can be tuned per user without prompt edits.
- Keep emoji minimal and purposeful; never spammy.

## Cadence
- Default: **1 post/day** at `DAILY_POST_CRON` (09:00).
- Mix over a week (example rotation): Mon text · Tue tip(text) · Wed carousel · Thu insight(text) ·
  Fri image · plus an occasional poll (manual). Tune via schedule rotations.

## Research → topic selection
- `ResearchService` pulls trending items for the chosen pillar, the LLM proposes angles, and the
  service **dedupes** against `topics.used_at` so stories aren't repeated.
- Without research APIs configured, the system falls back to LLM ideation seeded by the pillar and
  recent-post history.

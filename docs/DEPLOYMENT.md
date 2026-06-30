# Deployment

Target: a **single small VPS** running **Docker Compose**. Services: `app` (web + in-process
scheduler), `postgres`, and `caddy` (TLS reverse proxy). No Redis/queue. Estimated cost ~$5–10/mo.

## Why HTTPS is required
Two inbound integrations need public HTTPS:
- **LinkedIn OAuth callback** (`/auth/linkedin/callback`).
- **Telegram webhook** (`/telegram/webhook`) — only if `TELEGRAM_USE_WEBHOOK=true`; long-polling
  needs no inbound URL.

Caddy terminates TLS (automatic Let's Encrypt) and proxies to `app`.

## Topology

```
            Internet (HTTPS)
                  │
              ┌───▼────┐
              │ Caddy  │  :443  (auto TLS)
              └───┬────┘
                  │ reverse proxy
              ┌───▼────┐     ┌──────────┐
              │  app   │────▶│ postgres │
              │ (node) │     └──────────┘
              └────────┘   (node-cron in-process; no queue)
            volumes: pg_data, assets_data
```

## docker-compose.yml (shape — created in Phase 0/7)

```yaml
services:
  app:
    build: { context: ., dockerfile: docker/Dockerfile }
    env_file: .env
    depends_on: [postgres]
    volumes: [ "assets_data:/app/data/assets" ]
    restart: unless-stopped

  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes: [ "pg_data:/var/lib/postgresql/data" ]
    restart: unless-stopped

  caddy:                      # prod only
    image: caddy:2
    ports: [ "80:80", "443:443" ]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    depends_on: [app]
    restart: unless-stopped

volumes: { pg_data: {}, assets_data: {}, caddy_data: {} }
```

> For **local dev**, run only `postgres` via compose and run `app` with `npm run dev`.
> Caddy is production-only.

## Caddyfile (shape)
```
your-domain.com {
    reverse_proxy app:3000
}
```

## First deploy — steps
1. Provision a VPS (Hetzner/DigitalOcean), point a domain's A record at it.
2. Install Docker + Docker Compose.
3. Clone repo; `cp .env.example .env` and fill **all** values (`APP_BASE_URL`,
   `LINKEDIN_REDIRECT_URI` must use the real domain).
4. `docker compose up -d` (brings up postgres, app, caddy).
5. `docker compose exec app npm run db:migrate`.
6. Visit `https://your-domain.com/auth/linkedin` → complete OAuth → tokens stored.
7. If using Telegram webhook: set it to `https://your-domain.com/telegram/webhook`.
8. Verify `GET /health` is green. Confirm a scheduled slot fires a draft to Telegram.

## Secrets
- Keep real secrets only in `.env` on the server (gitignored) or Docker secrets.
- `SECRET_KEY` encrypts OAuth tokens at rest — generate a strong 32-byte value; rotating it
  invalidates stored tokens (re-auth required).
- Never bake secrets into the image.

## Backups
- **Postgres:** nightly `pg_dump` via cron on the host (or a small sidecar), retained off-box.
  ```bash
  docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
    | gzip > backup-$(date +%F).sql.gz
  ```
- **Assets:** the `assets_data` volume; back up alongside DB or move to S3-compatible storage later.

## Updates / rollout
- `git pull && docker compose build app && docker compose up -d app` (zero-config restart).
- Run migrations after deploy: `docker compose exec app npm run db:migrate`.

## Optional CI (GitHub Actions)
- On push to `main`: install, lint, test (vitest), build image.
- Deploy by SSHing to the VPS and running the update commands above. Keep deploy keys/secrets in
  GitHub Actions secrets.

## Scaling later (not v1, not needed for personal use)
- If volume ever grows past what one process handles, reintroduce a queue (Redis + BullMQ) and split
  `app` into `web` and `worker` services — the core modules sit behind interfaces, so this is
  additive, not a rewrite.
- Move assets to object storage; add a managed Postgres if DB load grows.

# LinkedIn Integration (Official API only)

This system publishes **only** through LinkedIn's official REST API — no browser automation or
scraping. This is a deliberate compliance-first decision (lowest account-risk, sustainable). The
trade-off: some formats (notably **polls**) are not available via the API for personal profiles and
are handled as `manual_required` content.

> ⚠️ **Read this before Phase 1.** Auto-publishing to your personal profile requires LinkedIn to
> approve your app for the right product. Start this approval process immediately — it gates
> publishing, not the rest of the build.

## 1. Create a LinkedIn Developer App

1. Go to <https://www.linkedin.com/developers/apps> → **Create app**.
2. Associate it with a LinkedIn **Company Page** (required) — create a minimal page if needed.
3. Note the **Client ID** and **Client Secret** → put in `.env`
   (`LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`).
4. Under **Auth**, add the **Authorized redirect URL**:
   `https://your-domain.com/auth/linkedin/callback` (must be HTTPS; matches `LINKEDIN_REDIRECT_URI`).

## 2. Request products / scopes

Request these **Products** in the app's *Products* tab (each requires review/approval):

| Product | Grants scopes | Used for |
|---------|---------------|----------|
| **Sign In with LinkedIn using OpenID Connect** | `openid`, `profile`, `email` | Auth + fetch member URN |
| **Share on LinkedIn** | `w_member_social` | Posting on behalf of the member |

> `w_member_social` is the critical scope for publishing. Approval can take time and may require a
> use-case description. Until granted, run the system in **Silent/Draft** mode — it still generates
> content + assets for manual posting.

Configured via `LINKEDIN_SCOPES` (default: `openid,profile,email,w_member_social`).

## 3. OAuth 2.0 flow (3-legged) — `src/linkedin/oauth.ts`

```
GET /auth/linkedin
   → 302 to https://www.linkedin.com/oauth/v2/authorization
        ?response_type=code
        &client_id=...&redirect_uri=...&scope=...&state=<csrf>

User authorizes →
GET /auth/linkedin/callback?code=...&state=...
   → POST https://www.linkedin.com/oauth/v2/accessToken
        grant_type=authorization_code, code, redirect_uri, client_id, client_secret
   → { access_token, expires_in, refresh_token, refresh_token_expires_in, scope }
   → encrypt + store in oauth_tokens
   → fetch member URN (below) and store member_urn
```

- **Member URN:** `GET https://api.linkedin.com/v2/userinfo` (OpenID) returns `sub` → author is
  `urn:li:person:{sub}`. (Legacy `GET /v2/me` also works.)
- **Refresh:** before `expires_at`, `POST /oauth/v2/accessToken` with
  `grant_type=refresh_token`. Run a proactive refresh check on a schedule and on `/health`.

## 4. Publishing endpoints — `src/linkedin/publishers/`

All requests go through `src/linkedin/client.ts`, which sets:
- `Authorization: Bearer <access_token>`
- `LinkedIn-Version: <YYYYMM>` (`LINKEDIN_API_VERSION`)
- `X-Restli-Protocol-Version: 2.0.0`

### Text post
`POST https://api.linkedin.com/rest/posts`
```jsonc
{
  "author": "urn:li:person:{id}",
  "commentary": "<body text>",
  "visibility": "PUBLIC",
  "distribution": { "feedDistribution": "MAIN_FEED" },
  "lifecycleState": "PUBLISHED"
}
```
Response header `x-restli-id` (or body) → the post URN. Build the public URL from the URN.

### Image post (text + image)
1. **Initialize upload:** `POST /rest/images?action=initializeUpload`
   `{ "initializeUploadRequest": { "owner": "urn:li:person:{id}" } }`
   → returns an `uploadUrl` + image `urn`.
2. **Upload bytes:** `PUT <uploadUrl>` with the image binary.
3. **Create post:** same `/rest/posts` body plus
   `"content": { "media": { "id": "<image-urn>", "altText": "..." } }`.

### Document / carousel (PDF)
1. **Initialize:** `POST /rest/documents?action=initializeUpload`
   `{ "initializeUploadRequest": { "owner": "urn:li:person:{id}" } }` → `uploadUrl` + document `urn`.
2. **Upload bytes:** `PUT <uploadUrl>` with the PDF.
3. **Create post:** `/rest/posts` with
   `"content": { "media": { "id": "<doc-urn>", "title": "<carousel title>" } }`.
   LinkedIn renders the PDF as a swipeable carousel.

### Poll — NOT supported via API
There is no public API to create a poll on a personal profile. The system:
- generates the poll (question + 2–4 options + framing),
- stores `content_items.status = manual_required`,
- sends it to Telegram with manual-posting instructions,
- never attempts an API publish.

## 5. Reliability & limits
- **Rate limits:** respect per-app/day throttles. On `HTTP 429`, back off exponentially and retry
  (in-process `p-retry` helper). Surface persistent throttling as a Telegram alert.
- **Versioning:** the `LinkedIn-Version` header is mandatory for `/rest/*`; bump `LINKEDIN_API_VERSION`
  (format `YYYYMM`) when adopting newer behavior. Keep it pinned and test before bumping.
- **Idempotency:** never publish without checking `content_items.status` + `dedupe_key` first, so a
  retried job can't double-post.
- **Token health:** if refresh fails (e.g. refresh token expired), set status accordingly and alert
  — re-auth via `/auth/linkedin` is required.

## 6. Endpoint reference (quick)

| Purpose | Method + Path |
|---------|---------------|
| Authorize | `GET /oauth/v2/authorization` |
| Token exchange / refresh | `POST /oauth/v2/accessToken` |
| Member info (URN) | `GET /v2/userinfo` |
| Create post | `POST /rest/posts` |
| Init image upload | `POST /rest/images?action=initializeUpload` |
| Init document upload | `POST /rest/documents?action=initializeUpload` |

> Endpoint shapes evolve. Treat this as the implementation starting point and verify against the
> current LinkedIn API docs when coding Phase 1/4; keep this file updated if they change.

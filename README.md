# Huawei AppGallery Auto-Publish

Upload an APK → we generate metadata, screenshots, translations (10 languages),
let you review, then push everything to Huawei AppGallery Connect.

## Stack
- Next.js 15 (App Router, RSC)
- Prisma + PostgreSQL
- OpenAI GPT-4o (metadata + translation)
- Appetize.io (optional, real-device screenshots) → falls back to template mockups
- Huawei AppGallery Connect Publishing API v2
- next-intl (English + Arabic dashboard UI, RTL-aware)

## Workflow
1. Register a Huawei app in the dashboard (one-time per product) with its **AGC App ID**, package name, and category.
2. Drop an APK in the dashboard.
3. The pipeline runs (background worker):
   1. Parse APK → package, version, icon, permissions, label
   2. Generate English store listing with GPT-4o
   3. Translate to 10 locales: `en-US`, `ar-EG`, `zh-CN`, `zh-TW`, `ru-RU`, `es-ES`, `fr-FR`, `de-DE`, `ja-JP`, `ko-KR`
   4. Generate phone screenshots (Appetize emulator if available; otherwise template mockups using app icon + tagline)
4. You see a **Pending review** card — edit any locale or screenshot, then click **Approve & publish**.
5. The worker uploads the APK + each localization + screenshots to Huawei, then calls `app-submit` for Huawei's review.

## Environment

See [`.env.example`](./.env.example). Required:

| Var | Where to get it |
| --- | --- |
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys |
| `HUAWEI_AGC_CLIENT_ID` / `HUAWEI_AGC_CLIENT_SECRET` | Huawei console → Users and permissions → API key → Connect API (scopes: app info, release, localization, image) |
| `HUAWEI_AGC_TEAM_ID` | Top-right of Huawei console |
| `DATABASE_URL` | A PostgreSQL connection string |
| `APPETIZE_API_TOKEN` | Optional. https://appetize.io account → API token |

## Run locally

```bash
npm install
cp .env.example .env  # fill in values
npm run db:push
# In one terminal:
npm run worker
# In another:
npm run dev
```

Then visit http://localhost:3000.

## Deploy to Fly.io

A `fly.toml` and `Dockerfile` are included. The deployment runs both the
Next.js web process and the worker process via supervisord.

```bash
fly launch --copy-config --no-deploy
fly secrets set OPENAI_API_KEY=... HUAWEI_AGC_CLIENT_ID=... HUAWEI_AGC_CLIENT_SECRET=... HUAWEI_AGC_TEAM_ID=...
fly postgres create
fly postgres attach <db-name>
fly deploy
```

## How the Huawei pipeline maps to AppGallery Connect API endpoints

| Step | Endpoint | Purpose |
| --- | --- | --- |
| `getAccessToken` | `POST /oauth2/v1/token` | Client credentials → bearer token (1h TTL) |
| `getUploadUrl` | `GET /publish/v2/upload-url` | One-shot upload slot for APK or image |
| `uploadFile` | `POST <uploadUrl>` | Multipart upload to Huawei's CDN |
| `updateAppFile` | `PUT /publish/v2/app-file-info` | Attach uploaded APK to release |
| `updateLanguageInfo` | `PUT /publish/v2/app-language-info` | Title / description / keywords per locale |
| `updateAppImage` | `PUT /publish/v2/app-image-info` | Screenshots per locale |
| `updateAppInfo` | `PUT /publish/v2/app-info` | Default lang, category |
| `submitForReview` | `POST /publish/v2/app-submit` | Submit version for Huawei reviewers |

See `src/lib/huawei-agc.ts` for the client implementation and
`src/lib/workflow.ts` for the orchestration of the full pipeline.

## Limitations / next steps
- The dashboard has no auth in v1 — put it behind a Cloudflare Access policy or NextAuth before exposing publicly.
- Privacy policy URL is required by Huawei but not collected — add a per-app field.
- Screenshots are English-only; per-locale screenshot generation is supported by the data model but the worker only generates English shots today.
- Huawei's IP whitelist must include the Fly.io app's egress IP — see `fly ips list` after deploy.

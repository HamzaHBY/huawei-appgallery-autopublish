# Huawei AppGallery Auto-Publish — Project Summary

> Comprehensive project context: what's built, what's deployed, what was considered, and what's available to build next.

---

## TL;DR

A fully-automated web app where you upload an APK and the system does everything else: parses the APK, writes the AppGallery listing with AI, generates real-device screenshots on a VMOS Cloud Android pad, translates to 10 languages, lets you preview/edit, then publishes to Huawei AppGallery for review.

- **Live site**: https://huawei-appgallery-autopublish.fly.dev
- **GitHub**: https://github.com/HamzaHBY/huawei-appgallery-autopublish
- **Active PR**: https://github.com/HamzaHBY/huawei-appgallery-autopublish/pull/1
- **API docs index**: `docs/apis.md` in the repo

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                  Next.js 15 (App Router)                     │
│                                                              │
│  Pages:    /        /settings    /uploads/[id]               │
│  i18n:     next-intl, en + ar (RTL), 10 listing locales      │
│                                                              │
│  API Routes (/api/...)                                       │
│    POST  /huawei-apps          register a Huawei app         │
│    POST  /uploads              upload APK (multipart)        │
│    GET   /uploads              list uploads                  │
│    GET   /uploads/[id]         get upload + state            │
│    PATCH /uploads/[id]/localizations/[locale]                │
│    POST  /uploads/[id]/approve queue for publishing          │
│    POST  /uploads/[id]/reject  reject this upload            │
│    GET   /uploads/[id]/apk     serve APK to VMOS (public)    │
│    GET   /screenshots/[id]/file serve screenshot to UI       │
└──────────────────────────────────────────────────────────────┘
                            │
                ┌───────────┴────────────┐
                ▼                        ▼
       ┌─────────────────┐      ┌─────────────────┐
       │   PostgreSQL    │      │  Worker (tsx)   │
       │  (Prisma 5.22)  │◄────►│  Job queue tick │
       └─────────────────┘      │  every 5s       │
                                └────────┬────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              ▼                          ▼                          ▼
   ┌─────────────────────┐  ┌─────────────────────┐  ┌──────────────────────┐
   │   OpenAI (gpt-4o)   │  │     VMOS Cloud      │  │  Huawei AGC API      │
   │  - Listing copy     │  │  install APK        │  │  - OAuth token       │
   │  - Translations     │  │  → start app        │  │  - Get upload URL    │
   │  - (DALL-E unused)  │  │  → screenshots      │  │  - Upload binary     │
   │                     │  │  → uninstall        │  │  - Set language info │
   │                     │  │                     │  │  - Submit for review │
   └─────────────────────┘  └─────────────────────┘  └──────────────────────┘
```

### Tech Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Framework | Next.js 15.5.18 (App Router, standalone output) | React 19 |
| Language | TypeScript 5.6, strict mode | |
| Styling | Tailwind CSS 3.4 + Inter font | Custom design tokens (brand colors) |
| Database | PostgreSQL 17.2 (Fly Postgres unmanaged) | Prisma 5.22 ORM |
| Internationalization | next-intl 3.25 | 10 listing locales + EN/AR dashboard |
| APK parsing | `app-info-parser` 1.1.4 | Reads manifest + icon |
| Image processing | `sharp` 0.33.5 | Resize/encode screenshots |
| AI | `openai` 4.73 | gpt-4o for text + translation |
| Validation | `zod` 3.23 | API request validation |
| Worker | `tsx` 4.19 (run as TS at runtime) | Single-process, polled job queue |
| Container | Multi-stage Node 20 Bookworm slim | supervisord runs web + worker |
| Deploy | Fly.io (region: fra) | 1 machine, autoscaling-off |

---

## 2. End-to-End Pipeline

When a user uploads an APK, this is what happens:

1. **Upload** — Multipart POST to `/api/uploads` writes the APK to the Fly volume (`/data/uploads/`), creates an `Upload` row with status `QUEUED`.
2. **PARSE_APK** job — Reads the APK manifest, extracts:
   - `packageName`, `versionName`, `versionCode`
   - `minSdkVersion`, `targetSdkVersion`
   - Permissions list
   - App label (default name)
   - App icon (extracted as PNG)
3. **GENERATE_METADATA** job — OpenAI gpt-4o gets the parsed metadata + permissions list and produces an English-language listing:
   - Title (≤30 chars, Huawei policy)
   - Short description (≤80 chars)
   - Full description (≤4000 chars)
   - Keywords (comma-separated)
   - What's new (≤500 chars)
   The system prompt enforces Huawei content policy (no third-party trademarks, no superlatives like "best ever", no medical/financial claims without disclaimer).
4. **TRANSLATE_METADATA** job — gpt-4o translates the English listing into the 9 other locales: `ar-EG`, `zh-CN`, `zh-TW`, `ru-RU`, `es-ES`, `fr-FR`, `de-DE`, `ja-JP`, `ko-KR`. One `Localization` row per locale.
5. **GENERATE_SCREENSHOTS** job — VMOS Cloud pipeline:
   1. Upload APK to your pad via `uploadFileV3` (with `autoInstall=1`).
   2. Wait for install task to complete (polls `fileTaskDetail`).
   3. Launch the app via `startApp` with the package name.
   4. Get a persistent preview URL via `getLongGenerateUrl` (or fall back to per-frame `screenshot`).
   5. Capture N screenshots, optionally swiping between (`simulateTouch`).
   6. Stop the app, uninstall.
   7. Each screenshot is processed via `sharp` (resize to 1080×1920, optimize, watermark if needed) and saved to the Fly volume.
6. **PENDING_REVIEW** — Upload status flips to `PENDING_REVIEW`. The user gets a dashboard view showing all 10 localizations, all screenshots, and "Approve & Publish" / "Reject" buttons.
7. **PUBLISH_TO_HUAWEI** job (only after user approval) —
   1. Get OAuth bearer token from Huawei `/oauth2/v1/token`.
   2. Look up `appId` by package name via `/publish/v2/app-id`.
   3. Get one-time upload URL via `/publish/v2/upload-url`.
   4. PUT the APK to the signed URL.
   5. Register the APK against the app via `/publish/v2/app-file-info`.
   6. For each locale: get image upload URL, upload screenshots, PUT `/publish/v2/app-language-info` with title/description/screenshots.
   7. Submit for review via `/publish/v2/app-submission`.
8. **SUBMITTED** — Upload status updated, Huawei `releaseId` stored. User can poll status from the dashboard.

Each step writes an `UploadEvent` row (audit log) visible in the UI. Jobs retry up to 3 times with exponential backoff. Failures surface to the user with an error message and the option to retry.

---

## 3. Database Schema (Prisma)

| Model | Purpose |
|-------|---------|
| `HuaweiApp` | Multi-tenant: register one row per Huawei app (`agcAppId` + `packageName`). User can manage multiple apps from Settings. |
| `Upload` | One row per APK uploaded; tracks the full pipeline state (status, current step, error, progress). |
| `Localization` | Per-locale listing text (title, short desc, full desc, keywords, what's new). |
| `Screenshot` | One row per generated screenshot, with `source` field (`emulator` / `template` / `ai`). |
| `Job` | Background work units with kind/status/attempts/payload. The worker polls this table every 5 seconds. |
| `UploadEvent` | Per-upload audit log shown in the UI. |
| `Setting` | Key-value table for runtime settings (placeholder for future per-user config). |

Job kinds: `PARSE_APK`, `GENERATE_METADATA`, `TRANSLATE_METADATA`, `GENERATE_SCREENSHOTS`, `PUBLISH_TO_HUAWEI`.
Upload statuses: `QUEUED`, `PARSING_APK`, `GENERATING_METADATA`, `GENERATING_SCREENSHOTS`, `TRANSLATING`, `PENDING_REVIEW`, `REJECTED_BY_USER`, `UPLOADING_TO_HUAWEI`, `SUBMITTED`, `PUBLISHED`, `FAILED`.

---

## 4. Fly.io Deployment

| Resource | Value |
|----------|-------|
| **App name** | `huawei-appgallery-autopublish` |
| **Org** | personal (Hamza BenYahya) |
| **Region** | `fra` (Frankfurt) |
| **Public URL** | https://huawei-appgallery-autopublish.fly.dev |
| **Image** | `huawei-appgallery-autopublish:deployment-01KSQW1V4BXNXXT1Y80FRVGV7Z` |
| **Machine ID** | `48e2133c945258` |
| **Machine version** | 3 (current latest) |
| **State** | started |
| **Process model** | Single machine, supervisord runs `node server.js` (web on `:3000`) + `tsx src/worker/index.ts` |

**IPs:**
| Type | Address |
|------|---------|
| Public ingress (IPv6 dedicated) | `2a09:8280:1::11b:f354:0` |
| Public ingress (IPv4 shared) | `66.241.125.32` |
| Egress (outbound for Huawei calls) | `50.31.197.123` |

**Volume:**
| Property | Value |
|----------|-------|
| Name | `appgallery_uploads` |
| ID | `vol_vlyd6qmoy1lmn5m4` |
| Size | 1 GB |
| Region | fra (zone 6e9e) |
| Encrypted | yes |
| Mounted at | `/data` |

**Postgres (unmanaged Fly Postgres):**
| Property | Value |
|----------|-------|
| App name | `huawei-autopublish-db` |
| Machine | `d89631dbe39418` |
| Image | `flyio/postgres-flex:17.2 (v0.1.0)` |
| Region | fra |
| Role | primary, 3/3 health checks passing |
| Database name | `huawei_appgallery_autopublish` |
| Host (internal Flycast) | `huawei-autopublish-db.flycast:5432` |
| `DATABASE_URL` | auto-attached by `fly postgres attach` |

**Secrets deployed** (values stored in Fly Vault, only `digest` exposed):

| Name | Used for |
|------|----------|
| `OPENAI_API_KEY` | gpt-4o text + translation |
| `HUAWEI_AGC_CLIENT_ID` | Huawei OAuth |
| `HUAWEI_AGC_CLIENT_SECRET` | Huawei OAuth |
| `VMOSCLOUD_ACCESS_KEY_ID` | VMOS V4 signing |
| `VMOSCLOUD_SECRET_ACCESS_KEY` | VMOS V4 signing |
| `VMOSCLOUD_PAD_CODE` | `ACP250526OW7GG3Z` (your real pad) |
| `APP_PUBLIC_URL` | Used by VMOS to download the APK from `/api/uploads/[id]/apk` |
| `APPETIZE_API_TOKEN` | Unused (kept as fallback) |
| `DATABASE_URL` | Postgres connection string |

**Commands you'll use to manage Fly:**
```bash
fly status -a huawei-appgallery-autopublish        # Current state
fly logs -a huawei-appgallery-autopublish          # Live logs
fly machine restart 48e2133c945258 -a huawei-appgallery-autopublish
fly deploy --remote-only -a huawei-appgallery-autopublish
fly secrets set FOO=bar -a huawei-appgallery-autopublish
fly secrets list -a huawei-appgallery-autopublish
fly ssh console -a huawei-appgallery-autopublish    # SSH into the machine
fly volumes list -a huawei-appgallery-autopublish
fly postgres connect -a huawei-autopublish-db       # psql shell
```

---

## 5. Repository Layout

```
huawei-appgallery-autopublish/
├── Dockerfile                       # Multi-stage build (base / deps / build / runner)
├── deploy/
│   ├── start.sh                     # Entrypoint: prisma db push → supervisord
│   └── supervisord.conf             # web (port 3000) + worker (tsx)
├── fly.toml                         # Fly config (region fra, volume mount /data)
├── prisma/schema.prisma             # 7 models, schema-driven
├── messages/                        # next-intl translations
│   ├── en.json                      # English UI
│   └── ar.json                      # Arabic UI (RTL)
├── docs/apis.md                     # Full API documentation index (committed)
├── src/
│   ├── app/                         # Next.js App Router pages + API routes
│   │   ├── page.tsx                 # Dashboard home
│   │   ├── settings/page.tsx        # Multi-app settings
│   │   ├── uploads/[id]/page.tsx    # Per-upload review + edit
│   │   ├── layout.tsx               # Root layout + locale switcher
│   │   ├── globals.css              # Tailwind base
│   │   └── api/                     # Route handlers (see section 2)
│   ├── components/                  # Client components (Dropzone, Reviewer, etc.)
│   ├── lib/
│   │   ├── apk-parser.ts            # Parse APK with app-info-parser
│   │   ├── huawei-agc.ts            # Huawei AGC API client
│   │   ├── openai.ts                # gpt-4o wrappers
│   │   ├── metadata-generator.ts    # Prompt orchestration
│   │   ├── vmoscloud.ts             # VMOS Cloud client (Volcano-Engine V4 signing)
│   │   ├── vmoscloud-screenshots.ts # Screenshot orchestrator
│   │   ├── appetize.ts              # Legacy Appetize.io client (kept as fallback)
│   │   ├── screenshots.ts           # Template-based mockup generator (fallback)
│   │   ├── workflow.ts              # Job runner + step orchestration
│   │   ├── locales.ts               # 10 listing locales config
│   │   └── db.ts                    # Prisma client singleton
│   └── worker/
│       └── index.ts                 # Job queue tick (polls every 5s)
└── package.json
```

---

## 6. Options You Were Given During the Project

This is everything you were offered along the way, plus what was chosen and what's still on the table.

### Q1: AI text + translation backend

| Option | Status | Trade-off |
|--------|--------|-----------|
| ✅ **OpenAI (gpt-4o)** — text + translation + (optional) image in one provider | **CHOSEN** | One API key, consistent quality, slightly more expensive than DeepL for translation. |
| Anthropic Claude + DeepL | not chosen | Two providers to manage; DeepL has the best translation quality but no image generation. |
| Google Translate API | not chosen | Cheapest but lower quality on app store copy. |
| Self-hosted (Llama 3, NLLB) | not chosen | No infra to run it; slow on Fly without GPU. |

### Q2: Screenshot generation backend

| Option | Status | Trade-off |
|--------|--------|-----------|
| ❌ Appetize.io API (real device emulator in the cloud) | Initially planned, then swapped | Free tier (100 min/mo) was tight; API token issued but never integrated end-to-end. |
| ✅ **VMOS Cloud** (real Android device emulator you provisioned) | **CHOSEN** | You already had a pad (`ACP250526OW7GG3Z`); persistent state; supports install/launch/swipe/screenshot via the OpenAPI. |
| AI-generated screenshots (DALL-E / SDXL / Replicate) | not chosen | Risk of rejection by Huawei reviewers for being too "AI-looking". |
| Template mockups (icon + tagline on device frame) | Kept as **fallback** in code | Works without any external service; less photorealistic. |
| Self-hosted Android emulator on Fly | not chosen | Fly's nested virtualization is restricted. |
| Self-hosted on a separate KVM VPS | not chosen | More infra to manage. |

### Q3: Target locales

| Option | Status |
|--------|--------|
| 5 most common (en, zh, es, fr, ar) | considered |
| ✅ **Top 10** (en-US, ar-EG, zh-CN, zh-TW, ru-RU, es-ES, fr-FR, de-DE, ja-JP, ko-KR) | **CHOSEN** |
| All Huawei-supported (~70 locales) | not chosen — would dramatically increase translation cost |

### Q4: User approval gate

| Option | Status |
|--------|--------|
| ✅ **Yes — show preview, allow edit, require Approve to submit** | **CHOSEN** |
| Fully unattended (auto-submit after generation) | not chosen — too risky given Huawei reviewer feedback loops |

### Q5: Repository setup

| Option | Status |
|--------|--------|
| ✅ **New repo `HamzaHBY/huawei-appgallery-autopublish`** | **CHOSEN** |
| Fork existing | not applicable |
| Subdirectory in another repo | not chosen |

### Q6: Huawei credentials acquisition

| Option | Status |
|--------|--------|
| You manually create the API key in the console and paste it | offered |
| ✅ **Devin logs into your Huawei account and creates the key live** | **CHOSEN** |

### Q7: Huawei IP whitelisting

| Option | Status |
|--------|--------|
| Whitelist the Fly egress IP (`50.31.197.123`) in the Connect API key | not applicable — the legacy "API client" type does not expose an IP whitelist field; only the newer "Service Account" credential does. |
| Migrate to "Service Account" credentials (JWT-signed, supports IP whitelist) | available — future hardening (~30 min of code change) |
| ✅ **Keep current API client, OAuth-only — already works** | **CURRENT** |

### Q8: Fly.io account

| Option | Status |
|--------|--------|
| ✅ **Use your existing `FLY_API_TOKEN` (personal org)** | **CHOSEN** |
| Use a separate account for the project | offered, not requested |

### Q9: Postgres choice

| Option | Status |
|--------|--------|
| ✅ **Fly Postgres unmanaged** (`huawei-autopublish-db`) | **CHOSEN** — free tier, internal Flycast networking |
| Fly Managed Postgres (`fly mpg`) | available — supported by Fly support, costs extra |
| Supabase / Neon / external Postgres | not chosen — external network cost |
| SQLite | not chosen — not safe for concurrent worker access |

### Q10: APK file storage

| Option | Status |
|--------|--------|
| ✅ **Fly persistent volume (1 GB at `/data`)** | **CHOSEN** for now |
| S3 / Cloudflare R2 / Backblaze B2 | available — better for >1 GB or multi-machine HA |
| Postgres BYTEA | not chosen — wasteful for binary blobs |

### Q11: Dashboard languages

| Option | Status |
|--------|--------|
| English only | considered |
| ✅ **English + Arabic (RTL)** | **CHOSEN** |
| All 10 target locales | available — would require translating UI copy 10× |

### Q12: Worker / background processing

| Option | Status |
|--------|--------|
| ✅ **In-process polled job queue (Postgres `Job` table, worker ticks every 5s)** | **CHOSEN** — simple, no extra infra |
| BullMQ + Redis | available — needed if scaling beyond 1 machine |
| Inngest / Trigger.dev (managed) | available — pay-per-use, more reliable for long-running jobs |
| pg-boss (Postgres-based job queue) | available — drop-in replacement when scaling |

---

## 7. What's Working Today

- [x] Dashboard renders in English and Arabic (RTL toggle)
- [x] Settings page registers Huawei apps (multi-tenant)
- [x] APK upload (multipart) → stored on Fly volume
- [x] APK parsing extracts manifest + icon + permissions
- [x] OpenAI gpt-4o generates Huawei-compliant listing copy
- [x] gpt-4o translates to all 10 locales
- [x] VMOS Cloud client with correct Volcano-Engine V4 signing (verified against your real pad)
- [x] VMOS screenshot pipeline (install → launch → capture → uninstall)
- [x] Per-upload review page (preview all locales + screenshots, edit text, approve/reject)
- [x] Huawei OAuth, upload URL, file binding, language info update, submission
- [x] Background worker (tsx) polls Postgres every 5s
- [x] Fly deployment with web + worker + Postgres + volume

## 8. What's Pending

- [ ] End-to-end test with a real APK (you need to send me one, or I'll grab a public one)
- [ ] First production submission to Huawei (real review feedback loop)
- [ ] (Optional) Browser profile snapshot approved by you so future sessions skip CAPTCHA

---

## 9. Features Catalog — Available to Build Next

Each item below is something you can request later. They're grouped by area; each has a one-line scope estimate.

### Pipeline & automation

- **Auto-publish after N hours of no edits** — Add a setting "auto-submit if not reviewed within X hours" (~1h).
- **Custom screenshot scripts per app** — Per-app config to script taps/swipes/wait times during screenshot capture (~3h).
- **Multi-APK / AAB upload** — Accept Android App Bundles, multi-APK uploads (~4h).
- **Version bump detection** — When uploading the same package name, prefill metadata from the previous version (~1h).
- **Rollback to previous version** — Trigger Huawei rollback API (~2h).
- **Phased rollout** — Use Huawei's percentage-based rollout feature (~2h).

### Screenshots & assets

- **Inline screenshot editor** — Crop/annotate/reorder screenshots in the dashboard before publishing (~5h).
- **Device frame compositor** — Wrap screenshots in Huawei P-series device frames (~3h).
- **Feature graphic generator** — Use gpt-image-1 / SDXL to generate 1024×500 Huawei feature graphic (~2h).
- **App icon enhancer** — Upscale/clean the APK icon for store quality (~1h).
- **A/B test screenshot variants** — Generate 2 sets, publish A to half of locales and B to other half (~6h).
- **Video preview generator** — Record a 30s screen capture from VMOS during screenshot pass (~4h).

### Localization

- **Add/remove locales per app** — Currently fixed list; make it per-app configurable (~2h).
- **Glossary / term consistency** — User-provided glossary so brand terms aren't translated (~2h).
- **Tone presets** — "formal / playful / professional" tone selectors for the AI copywriter (~1h).
- **Human review hand-off** — Mark a locale as "needs human review" and email a contributor (~3h).
- **Reverse-translate sanity check** — Translate AR→EN and show the user any drift (~2h).

### Multi-platform publishing

- **Google Play Console publisher** — Add Play Console API path, reuse metadata/screenshots (~10h).
- **Apple App Store Connect publisher** — App Store Connect API (~12h).
- **Samsung Galaxy Store publisher** — Galaxy Store seller API (~6h).
- **Amazon Appstore publisher** — Amazon Developer API (~6h).
- **Cross-store unified dashboard** — Single dashboard showing review status across all stores (~4h).

### User management & multi-tenancy

- **Login (email + magic link)** — Replace anonymous-access with per-user accounts (~4h).
- **Team workspaces** — Multiple users per workspace, role-based access (~6h).
- **Per-user secret vault** — Each user supplies their own Huawei/OpenAI keys, no global env (~3h).
- **Audit log of every action** — Already partially built (UploadEvent); expose in UI (~1h).

### Admin & observability

- **Public status page** — `/status` endpoint with pipeline health, queue depth, Huawei API latency (~2h).
- **Sentry / OpenTelemetry integration** — Capture errors centrally (~1h).
- **Slack / Discord notifications** — Pipeline status updates pushed to a channel (~1h).
- **Webhook on publish status change** — Hit a user-provided URL when status flips to `PUBLISHED` (~1h).

### Huawei-specific deepening

- **Migrate to Service Account credentials** — JWT-signed, supports IP whitelist (~2h).
- **App information management** — Edit category, content rating, target audience programmatically (~3h).
- **In-app purchase product management** — Create/update IAP SKUs via Huawei IAP API (~5h).
- **Real-time review status polling** — Show Huawei reviewer comments as they come in (~3h).
- **Auto-resubmit on reviewer feedback** — If Huawei rejects, AI fixes the issue and resubmits (~5h).

### Quality & policy

- **Pre-submission policy linter** — Check the listing text against Huawei's content policy AND your own custom rules (~2h).
- **APK static analysis** — Scan for tracking SDKs, permissions misuse, banned libraries (~6h).
- **Compliance scanner for GDPR / CCPA / Chinese MIIT / Russian Roskomnadzor** — Region-specific privacy compliance (~10h).

### Performance / scale

- **Multi-machine deployment with shared S3 storage** — Scale beyond one Fly machine (~4h).
- **Redis-backed job queue (BullMQ)** — Replace polled Postgres queue when you go multi-machine (~3h).
- **CDN for screenshots / icons** — Move static assets to Cloudflare R2 + Workers (~3h).

### Monetization (if you turn this into a SaaS)

- **Stripe billing** — Per-publish or per-month plans (~5h).
- **Tiered limits** — Free / Pro / Enterprise plans (~3h).
- **Affiliate / referral program** — Track sign-ups via referral code (~4h).

---

## 10. Where Everything Is

- **Code**: https://github.com/HamzaHBY/huawei-appgallery-autopublish (PR #1)
- **Live app**: https://huawei-appgallery-autopublish.fly.dev
- **Fly dashboard**: https://fly.io/apps/huawei-appgallery-autopublish
- **Fly Postgres**: https://fly.io/apps/huawei-autopublish-db
- **Huawei AppGallery Connect console**: https://developer.huawei.com/consumer/en/console
- **API key (Devin Auto-Publisher)**: AppGallery Connect → Users and permissions → API key → Connect API → API client tab
- **OpenAI dashboard**: https://platform.openai.com/api-keys
- **VMOS Cloud console**: https://cloud.vmoscloud.com/
- **VMOS pad in use**: `ACP250526OW7GG3Z`
- **All Devin secrets stored persistently** (so future Devin sessions inherit them automatically)

---

## 11. Commands Cheat Sheet

```bash
# Local dev
npm install
npx prisma generate
npx prisma db push
npm run dev                 # Next.js dev server on :3000
npm run worker              # Worker in another terminal
npm run lint                # ESLint
npm run typecheck           # tsc --noEmit

# Fly
fly status -a huawei-appgallery-autopublish
fly logs -a huawei-appgallery-autopublish
fly deploy --remote-only -a huawei-appgallery-autopublish
fly secrets set KEY=value -a huawei-appgallery-autopublish
fly ssh console -a huawei-appgallery-autopublish

# Postgres
fly postgres connect -a huawei-autopublish-db
```

---

When you come back with a feature request, point me at the section above (e.g. "implement #Pipeline > Auto-publish after N hours") and I already have all the context I need to ship it.

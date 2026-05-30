# Huawei AppGallery Connect API Reference

All Huawei APIs used by this auto-publisher, with official documentation links.

> **Auth model**: All calls use OAuth 2.0 client credentials flow. Bearer tokens are obtained from `/oauth2/v1/token` using the `client_id` and `client_secret` of the "Devin Auto-Publisher" Connect API key (created in your account). Tokens are valid for 1 hour and are auto-refreshed.

---

## 1. Connect API (publishing) — `connect-api.cloud.huawei.com`

The Connect API is the core API for managing AppGallery apps programmatically.

| # | Endpoint | What it does | Used by | Docs |
|---|----------|--------------|---------|------|
| 1.1 | `POST /api/oauth2/v1/token` | Obtain OAuth access token from client credentials. | `src/lib/huawei.ts` → `getToken()` | [OAuth token](https://developer.huawei.com/consumer/en/doc/AppGallery-connect-References/agcapi-getstarted-0000001111845114) |
| 1.2 | `GET /api/publish/v2/app-id` | Look up a Huawei `appId` by package name. | `src/lib/huawei.ts` → `lookupAppId()` | [Query app ID](https://developer.huawei.com/consumer/en/doc/AppGallery-connect-References/agcapi-appid-list-0000001158245135) |
| 1.3 | `GET /api/publish/v2/upload-url` | Get a one-time signed upload URL for an APK/AAB. | `src/lib/huawei.ts` → `getUploadUrl()` | [Obtain upload URL](https://developer.huawei.com/consumer/en/doc/AppGallery-connect-References/agcapi-obtain-uploadurl-0000001158245149) |
| 1.4 | `POST <signed URL>` (multipart) | Upload the APK binary to the signed URL. | `src/lib/huawei.ts` → `uploadFile()` | [Upload file](https://developer.huawei.com/consumer/en/doc/AppGallery-connect-References/agcapi-file-upload-0000001158245151) |
| 1.5 | `PUT /api/publish/v2/app-file-info` | Register the uploaded APK against the app (binds `fileDestUrl` to `appId`). | `src/lib/huawei.ts` → `submitAppFile()` | [Update file info](https://developer.huawei.com/consumer/en/doc/AppGallery-connect-References/agcapi-file-info-update-0000001111685206) |
| 1.6 | `PUT /api/publish/v2/app-language-info` | Update language-specific listing (title, description, what's new) per locale. | `src/lib/huawei.ts` → `updateLocalization()` | [Update language info](https://developer.huawei.com/consumer/en/doc/AppGallery-connect-References/agcapi-language-info-update-0000001111525184) |
| 1.7 | `GET /api/publish/v2/upload-url/image` | Get a signed upload URL for screenshot/icon assets. | `src/lib/huawei.ts` → `getImageUploadUrl()` | [Image upload URL](https://developer.huawei.com/consumer/en/doc/AppGallery-connect-References/agcapi-image-uploadurl-0000001111685210) |
| 1.8 | `PUT /api/publish/v2/app-language-info` (with `fileType=icon/screenshot`) | Bind uploaded screenshots/icon to a locale. | `src/lib/huawei.ts` → `bindMediaToLocale()` | [Bind media](https://developer.huawei.com/consumer/en/doc/AppGallery-connect-References/agcapi-language-info-update-0000001111525184) |
| 1.9 | `POST /api/publish/v2/app-submission` | Submit the release for Huawei review. | `src/lib/huawei.ts` → `submitForReview()` | [Submit for review](https://developer.huawei.com/consumer/en/doc/AppGallery-connect-References/agcapi-submit-0000001158245155) |
| 1.10 | `GET /api/publish/v2/app-info` | Read current app state, version, audit status. | `src/lib/huawei.ts` → `getAppInfo()` | [Query app info](https://developer.huawei.com/consumer/en/doc/AppGallery-connect-References/agcapi-app-info-query-0000001111525186) |

**Top-level docs**:
- [Publishing API overview](https://developer.huawei.com/consumer/en/doc/AppGallery-connect-References/agcapi-getstarted-0000001111845114)
- [Connect API getting started](https://developer.huawei.com/consumer/en/doc/AppGallery-connect-Guides/agcapi-getstarted-0000001111845114)
- [Error code list](https://developer.huawei.com/consumer/en/doc/AppGallery-connect-References/agcapi-error-codes-0000001158245157)

**Required scopes** (for the Connect API key, must be enabled in the console):
- `publish:app:info` — App information management
- `publish:app:release` — App release management
- `publish:app:loc` — App localization
- `publish:app:image` — App media management

---

## 2. OpenAI APIs — `api.openai.com`

Used for text + translation + (optional) image generation.

| # | Endpoint | What it does | Used by | Docs |
|---|----------|--------------|---------|------|
| 2.1 | `POST /v1/chat/completions` (model: `gpt-4o`) | Generate listing text from APK metadata. | `src/lib/openai.ts` → `generateListing()` | [Chat Completions](https://platform.openai.com/docs/api-reference/chat) |
| 2.2 | `POST /v1/chat/completions` (model: `gpt-4o`) | Translate listing into target locales. | `src/lib/openai.ts` → `translateListing()` | [Chat Completions](https://platform.openai.com/docs/api-reference/chat) |
| 2.3 | `POST /v1/images/generations` (model: `gpt-image-1`) | Optional: generate marketing screenshots. | `src/lib/openai.ts` → `generateImage()` (currently unused; VMOS path active) | [Image generation](https://platform.openai.com/docs/api-reference/images/create) |

---

## 3. VMOS Cloud APIs — `api.vmoscloud.com`

Used for real Android device emulation: install APK → launch → screenshot → uninstall.

**Auth**: Volcano-Engine V4 HMAC-SHA256 signing (service `armcloud-paas`). Each request needs `x-date`, `x-host`, and `authorization: HMAC-SHA256 Credential=…/…/armcloud-paas/request, SignedHeaders=…, Signature=…`.

| # | Endpoint | What it does | Used by |
|---|----------|--------------|---------|
| 3.1 | `POST /vcpcloud/api/padApi/listUserPads` | List all VMOS Cloud devices you own. | `VmosCloudClient.listUserPads()` |
| 3.2 | `POST /vcpcloud/api/padApi/uploadFileV3` | Upload APK from a public URL to the device (with `autoInstall=1`). | `VmosCloudClient.installApp()` |
| 3.3 | `POST /vcpcloud/api/padApi/listInstalledApp` | List apps installed on the device. | `VmosCloudClient.listInstalledApp()` |
| 3.4 | `POST /vcpcloud/api/padApi/startApp` | Launch app by package name on the device. | `VmosCloudClient.startApp()` |
| 3.5 | `POST /vcpcloud/api/padApi/stopApp` | Stop the running app. | `VmosCloudClient.stopApp()` |
| 3.6 | `POST /vcpcloud/api/padApi/restartApp` | Restart the app. | `VmosCloudClient.restartApp()` |
| 3.7 | `POST /vcpcloud/api/padApi/screenshot` | Capture a screenshot, returns pre-signed `accessUrl`. | `VmosCloudClient.screenshot()` |
| 3.8 | `POST /vcpcloud/api/padApi/getLongGenerateUrl` | Get a persistent preview URL (reused across multiple captures). | `VmosCloudClient.getLongGenerateUrl()` |
| 3.9 | `POST /vcpcloud/api/padApi/simulateTouch` | Simulate tap/swipe (used to navigate the app between screenshots). | `VmosCloudClient.simulateTap()`, `simulateSwipe()` |
| 3.10 | `POST /vcpcloud/api/padApi/asyncCmd` | Run ADB shell command on the device. | `VmosCloudClient.asyncCmd()` |
| 3.11 | `POST /vcpcloud/api/padApi/fileTaskDetail` | Poll status of an upload/install task. | `VmosCloudClient.getFileTaskDetail()` |
| 3.12 | `POST /vcpcloud/api/padApi/padTaskDetail` | Poll status of a generic device task. | `VmosCloudClient.getPadTaskDetail()` |

**Docs**: VMOS Cloud docs are gated. Reference docs from the official Node.js example:
- [VMOS Cloud OpenAPI getting started](https://cloud.vmoscloud.com/vmoscloud/doc/en/server/example.html)

---

## Quick links to your accounts

- **Huawei AppGallery Connect console**: https://developer.huawei.com/consumer/en/console
- **Huawei Connect API page** (manage the "Devin Auto-Publisher" key, scopes, IP whitelist): https://developer.huawei.com/consumer/en/console#/serviceCards/12058
- **Huawei AGC docs root**: https://developer.huawei.com/consumer/en/doc/AppGallery-connect-References
- **OpenAI dashboard**: https://platform.openai.com/api-keys
- **VMOS Cloud console**: https://cloud.vmoscloud.com/
- **Fly.io app**: https://fly.io/apps/huawei-appgallery-autopublish
- **Live site**: https://huawei-appgallery-autopublish.fly.dev

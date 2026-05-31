// Huawei AppGallery Connect Publishing API client.
//
// Reference:
//   https://developer.huawei.com/consumer/en/doc/AppGallery-connect-References/agcapi-publish-overview-0000001158245001
//
// Flow:
//   1. POST /oauth2/v1/token  → access_token (1h TTL)
//   2. GET  /publish/v2/upload-url  → upload URL + auth code (per APK chunk)
//   3. POST <uploadUrl>  → upload APK (multipart)
//   4. PUT  /publish/v2/app-file-info  → attach uploaded APK to app
//   5. PUT  /publish/v2/app-language-info  → set localization
//   6. PUT  /publish/v2/app-info  → set generic app info (category)
//   7. PUT  /publish/v2/app-image-info  → attach screenshots
//   8. POST /publish/v2/app-submit  → submit for review
//
// All endpoints require headers:
//   Authorization: Bearer <token>
//   client_id: <client_id>
//   Content-Type: application/json (except multipart upload)

import { promises as fs } from "fs";

const BASE_URL = "https://connect-api.cloud.huawei.com/api";

// Broad default distribution list used when an app has no countries configured.
// Huawei needs at least one distribution country before an APK can be uploaded
// (the OBS site is resolved from this list).
const DEFAULT_PUBLISH_COUNTRIES =
  "SG,MY,TH,HK,MO,TW,AU,ID,QA,KW,IL,SA,LB,BH,JO,PK,AE,OM,GB,FR,DE,IT,FI,CH,ES,DK,SE,BE," +
  "NL,AT,PL,US,JP,KR,NZ,PH,VN,BD,IN,TR,UA,RU,ZA,EG,MA,NG,BR,MX,CA";

export interface HuaweiCredentials {
  clientId: string;
  clientSecret: string;
}

export interface HuaweiAgcClientOptions extends HuaweiCredentials {
  // Some accounts must include team_id in queries. Optional.
  teamId?: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache: Map<string, CachedToken> = new Map();

export class HuaweiAgcError extends Error {
  constructor(
    message: string,
    public ret?: { code: number; msg: string },
    public httpStatus?: number,
  ) {
    super(message);
    this.name = "HuaweiAgcError";
  }
}

interface HuaweiResponse<T = unknown> {
  ret: { code: number; msg: string };
  // Many endpoints return additional fields at the top level alongside `ret`.
  [key: string]: unknown;
  data?: T;
}

export class HuaweiAgcClient {
  constructor(private readonly opts: HuaweiAgcClientOptions) {}

  // ---------------------- OAuth ----------------------

  async getAccessToken(): Promise<string> {
    const cached = tokenCache.get(this.opts.clientId);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

    const res = await fetch(`${BASE_URL}/oauth2/v1/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: this.opts.clientId,
        client_secret: this.opts.clientSecret,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new HuaweiAgcError(`OAuth failed: ${res.status} ${text}`, undefined, res.status);
    }
    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      ret?: { code: number; msg: string };
    };
    if (!json.access_token) {
      throw new HuaweiAgcError(`OAuth response missing access_token`, json.ret);
    }
    const expiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
    tokenCache.set(this.opts.clientId, { token: json.access_token, expiresAt });
    return json.access_token;
  }

  // ---------------------- Internal helpers ----------------------

  private async authedFetch<T = unknown>(
    path: string,
    init: RequestInit & { query?: Record<string, string | number | undefined> } = {},
  ): Promise<HuaweiResponse<T>> {
    const token = await this.getAccessToken();
    const url = new URL(`${BASE_URL}${path}`);
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      client_id: this.opts.clientId,
      ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    };

    const res = await fetch(url.toString(), { ...init, headers });
    const text = await res.text();
    let parsed: HuaweiResponse<T>;
    try {
      parsed = text ? (JSON.parse(text) as HuaweiResponse<T>) : ({ ret: { code: 0, msg: "ok" } } as HuaweiResponse<T>);
    } catch {
      throw new HuaweiAgcError(`Non-JSON response from ${path}: ${text.slice(0, 200)}`, undefined, res.status);
    }
    if (!res.ok || (parsed.ret && parsed.ret.code !== 0)) {
      throw new HuaweiAgcError(`Huawei ${path} failed: ${parsed.ret?.msg ?? res.statusText}`, parsed.ret, res.status);
    }
    return parsed;
  }

  // ---------------------- File upload (OBS flow) ----------------------

  // Obtain a presigned OBS upload slot (current Huawei flow).
  //   GET /publish/v2/upload-url/for-obs → { urlInfo: { url, headers, objectId } }
  // The returned `objectId` is what must be bound via app-file-info /
  // app-image-info. Binding the destination URL instead is rejected by Huawei
  // with "The files url is not objectId" — the legacy `/upload-url` +
  // `fileDestUrl` flow no longer works for new versions.
  async getUploadUrl(
    appId: string,
    fileName: string,
    contentLength: number,
    suffix: "apk" | "aab" | "png" | "jpg" = "apk",
  ): Promise<{ url: string; headers: Record<string, string>; objectId: string }> {
    const json = await this.authedFetch(`/publish/v2/upload-url/for-obs`, {
      method: "GET",
      query: { appId, fileName, contentLength, suffix },
    });
    const urlInfo = (json as Record<string, unknown>).urlInfo as
      | { url?: string; headers?: Record<string, string>; objectId?: string }
      | undefined;
    if (!urlInfo?.url || !urlInfo?.objectId) {
      throw new HuaweiAgcError(
        `upload-url/for-obs missing urlInfo: ${JSON.stringify(json).slice(0, 300)}`,
      );
    }
    return { url: urlInfo.url, headers: urlInfo.headers ?? {}, objectId: urlInfo.objectId };
  }

  // Upload a local file to the presigned OBS URL via a single PUT, echoing the
  // signed headers Huawei returned. Returns the objectId used to bind the file.
  async uploadFile(
    filePath: string,
    slot: { url: string; headers: Record<string, string>; objectId: string },
  ): Promise<{ objectId: string; size: string }> {
    const buf = await fs.readFile(filePath);
    // Echo the signed headers verbatim, but drop Host/Content-Length — fetch
    // (undici) sets these itself to match the request, and Host is a forbidden
    // header. The signed Host equals the URL host, so this stays valid.
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(slot.headers ?? {})) {
      const lk = k.toLowerCase();
      if (lk === "host" || lk === "content-length") continue;
      if (typeof v === "string") headers[k] = v;
    }
    const res = await fetch(slot.url, { method: "PUT", headers, body: buf });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new HuaweiAgcError(`OBS upload failed: ${res.status} ${text.slice(0, 300)}`);
    }
    return { objectId: slot.objectId, size: String(buf.length) };
  }

  // ---------------------- App metadata ----------------------

  // Attach an uploaded APK to an app. `objectId` comes from getUploadUrl/
  // uploadFile and is bound via the `fileDestUrl` body field (Huawei's field
  // name; the value must be the objectId, not a URL).
  async updateAppFile(appId: string, objectId: string, fileName: string) {
    return this.authedFetch(`/publish/v2/app-file-info`, {
      method: "PUT",
      query: { appId, releaseType: 1 },
      body: JSON.stringify({
        fileType: 5, // 5 = RPK/APK release file
        files: [{ fileName, fileDestUrl: objectId }],
      }),
    });
  }

  // Update localized listing
  async updateLanguageInfo(
    appId: string,
    lang: string,
    data: {
      appName: string;
      appDesc: string;
      briefInfo: string;
      keywords?: string;
      newFeatures?: string;
    },
  ) {
    return this.authedFetch(`/publish/v2/app-language-info`, {
      method: "PUT",
      query: { appId, releaseType: 1 },
      body: JSON.stringify({
        lang,
        ...data,
      }),
    });
  }

  // Attach screenshots to a locale (after uploading via getUploadUrl/uploadFile).
  // Each image is bound by its objectId, same as the APK.
  async updateAppImage(
    appId: string,
    lang: string,
    imageType: "screenshot" | "icon" = "screenshot",
    imageList: Array<{ objectId: string; fileName: string }>,
  ) {
    const huaweiType = imageType === "screenshot" ? 5 : 1; // 5 = phone screenshot, 1 = icon
    return this.authedFetch(`/publish/v2/app-image-info`, {
      method: "PUT",
      query: { appId, releaseType: 1 },
      body: JSON.stringify({
        lang,
        imageType: huaweiType,
        imageList: imageList.map((img) => ({
          fileDestUrl: img.objectId,
          fileName: img.fileName,
        })),
      }),
    });
  }

  async updateAppInfo(
    appId: string,
    data: {
      defaultLang?: string;
      privacyPolicy?: string;
      categoryId?: number;
    },
  ) {
    return this.authedFetch(`/publish/v2/app-info`, {
      method: "PUT",
      query: { appId, releaseType: 1 },
      body: JSON.stringify(data),
    });
  }

  // Submit the version for Huawei's review.
  async submitForReview(appId: string, releaseTime?: string) {
    return this.authedFetch(`/publish/v2/app-submit`, {
      method: "POST",
      query: { appId, releaseType: 1, releaseTime },
    });
  }

  // Read app summary (sanity-check that the app exists and we have access)
  async getAppInfo(appId: string) {
    return this.authedFetch(`/publish/v2/app-info`, {
      method: "GET",
      query: { appId, releaseType: 1 },
    });
  }

  // The OBS upload endpoint (/upload-url/for-obs) resolves which storage site to
  // use from the app's distribution country list. If the app has no distribution
  // countries set, APK uploads fail with:
  //   "[cfs] get siteId failed ... distContryList is empty and usage route site is not China."
  // This ensures a country list exists before we request an upload URL.
  // Returns true if countries are present (already or after setting them).
  async ensureDistributionCountries(appId: string): Promise<boolean> {
    const info = (await this.getAppInfo(appId)) as Record<string, unknown>;
    const appInfo = (info.appInfo ?? {}) as Record<string, unknown>;
    const existing = (appInfo.publishCountry as string | undefined) ?? "";
    if (existing.trim().length > 0) return true;

    try {
      await this.authedFetch(`/publish/v2/app-info`, {
        method: "PUT",
        query: { appId, releaseType: 1 },
        body: JSON.stringify({ publishCountry: DEFAULT_PUBLISH_COUNTRIES }),
      });
    } catch (err) {
      // 204144757 = category not selected. Huawei refuses to persist ANY
      // app-info change (including countries) until a category is chosen, and
      // the category cannot be set through the publishing API. Surface a clear,
      // actionable message instead of the cryptic "distContryList is empty".
      const msg = err instanceof HuaweiAgcError ? err.ret?.msg ?? err.message : String(err);
      throw new HuaweiAgcError(
        `App ${appId} cannot be published yet: it has no distribution countries and ` +
          `Huawei rejected setting them because the app category is not selected ` +
          `(Huawei: "${msg}"). Open this app in AppGallery Connect → App information, ` +
          `select a category and distribution countries (and complete content rating / ` +
          `privacy policy if prompted), then retry. The category cannot be set via the API.`,
      );
    }

    // Re-check that the write actually persisted.
    const after = (await this.getAppInfo(appId)) as Record<string, unknown>;
    const afterInfo = (after.appInfo ?? {}) as Record<string, unknown>;
    return ((afterInfo.publishCountry as string | undefined) ?? "").trim().length > 0;
  }

  // Resolve the AGC appId(s) for one or more package names.
  // GET /publish/v2/appid-list?packageName=a,b  → { appids: [{ key: name, value: appId }] }
  // Returns a map of packageName -> appId (only for packages that resolved).
  async queryAppIdByPackage(packageNames: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (packageNames.length === 0) return result;
    const json = await this.authedFetch<unknown>(`/publish/v2/appid-list`, {
      method: "GET",
      query: { packageName: packageNames.join(",") },
    });
    // Response shape: { ret, appids: [{ key: <appName>, value: <appId> }] }
    // Huawei keys the pair by app *name*, not package — so when querying a single
    // package the single returned value is the appId for that package.
    const appids = (json as Record<string, unknown>).appids as
      | Array<{ key?: string; value?: string }>
      | undefined;
    if (appids && appids.length > 0 && packageNames.length === 1) {
      const v = appids[0]?.value;
      if (v) result.set(packageNames[0], v);
    }
    return result;
  }
}

export function huaweiClientFromEnv(): HuaweiAgcClient {
  const clientId = process.env.HUAWEI_AGC_CLIENT_ID;
  const clientSecret = process.env.HUAWEI_AGC_CLIENT_SECRET;
  const teamId = process.env.HUAWEI_AGC_TEAM_ID;
  if (!clientId || !clientSecret) {
    throw new Error("HUAWEI_AGC_CLIENT_ID and HUAWEI_AGC_CLIENT_SECRET must be set");
  }
  return new HuaweiAgcClient({ clientId, clientSecret, teamId });
}


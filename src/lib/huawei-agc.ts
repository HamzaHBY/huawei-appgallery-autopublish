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

import { createReadStream, promises as fs } from "fs";
import { basename } from "path";

const BASE_URL = "https://connect-api.cloud.huawei.com/api";

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

  // ---------------------- File upload ----------------------

  // Get an upload URL for an APK or image.
  async getUploadUrl(appId: string, suffix: "apk" | "png" | "jpg" = "apk") {
    const json = await this.authedFetch<{
      uploadUrl: string;
      authCode: string;
      chunkUploadUrl?: string;
    }>(`/publish/v2/upload-url`, {
      method: "GET",
      query: {
        appId,
        suffix,
        releaseType: 1,
      },
    });
    const uploadUrl = (json as Record<string, unknown>).uploadUrl as string | undefined;
    const authCode = (json as Record<string, unknown>).authCode as string | undefined;
    if (!uploadUrl || !authCode) {
      throw new HuaweiAgcError(`upload-url response missing fields: ${JSON.stringify(json)}`);
    }
    return { uploadUrl, authCode };
  }

  // Upload a local file to Huawei's edge.
  async uploadFile(filePath: string, uploadUrl: string, authCode: string, fileName?: string) {
    const stat = await fs.stat(filePath);
    const name = fileName ?? basename(filePath);

    const form = new FormData();
    form.append("authCode", authCode);
    form.append("fileCount", "1");
    // FormData in Node 20+ supports streams via Blob — convert from file.
    const buf = await fs.readFile(filePath);
    form.append("file", new Blob([buf]), name);

    const res = await fetch(uploadUrl, { method: "POST", body: form });
    if (!res.ok) {
      const text = await res.text();
      throw new HuaweiAgcError(`File upload failed: ${res.status} ${text}`);
    }
    const json = (await res.json()) as {
      result?: {
        UploadFileRsp?: {
          ifSuccess?: number;
          // NOTE: Huawei's upload response misspells the URL field as
          // `fileDestUlr` (not `fileDestUrl`). Accept both so a future API
          // fix doesn't silently break us.
          fileInfoList?: Array<{
            fileDestUrl?: string;
            fileDestUlr?: string;
            size: string;
          }>;
        };
      };
    };
    const ok = json.result?.UploadFileRsp?.ifSuccess === 1;
    if (!ok) {
      throw new HuaweiAgcError(`File upload rejected: ${JSON.stringify(json)}`);
    }
    const raw = json.result?.UploadFileRsp?.fileInfoList?.[0];
    if (!raw) throw new HuaweiAgcError(`File upload returned no fileInfo`);
    const fileDestUrl = raw.fileDestUrl ?? raw.fileDestUlr;
    if (!fileDestUrl) {
      throw new HuaweiAgcError(`File upload returned no fileDestUrl: ${JSON.stringify(raw)}`);
    }
    void stat;
    return { fileDestUrl, size: raw.size };
  }

  // ---------------------- App metadata ----------------------

  // Attach an uploaded APK to an app
  async updateAppFile(
    appId: string,
    fileDestUrl: string,
    fileSize: string,
    fileName: string,
  ) {
    return this.authedFetch(`/publish/v2/app-file-info`, {
      method: "PUT",
      query: { appId, releaseType: 1 },
      body: JSON.stringify({
        fileType: 5, // 5 = RPK/APK release file
        files: [{ fileName, fileDestUrl, size: fileSize }],
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

  // Attach a screenshot to a locale (after uploading via getUploadUrl/uploadFile)
  async updateAppImage(
    appId: string,
    lang: string,
    imageType: "screenshot" | "icon" = "screenshot",
    imageList: Array<{ fileDestUrl: string; fileName: string; size: string }>,
  ) {
    const huaweiType = imageType === "screenshot" ? 5 : 1; // 5 = phone screenshot, 1 = icon
    return this.authedFetch(`/publish/v2/app-image-info`, {
      method: "PUT",
      query: { appId, releaseType: 1 },
      body: JSON.stringify({
        lang,
        imageType: huaweiType,
        imageList: imageList.map((img) => ({
          fileDestUrl: img.fileDestUrl,
          fileName: img.fileName,
          size: img.size,
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

// Keep createReadStream import in scope (used in future streaming upload variants)
void createReadStream;

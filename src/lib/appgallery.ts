// Download an APK + analyze it from a public Huawei AppGallery link.
//
// Method (same as gnuvalerie/appgallerycli): Huawei exposes a stable binary
// endpoint at https://appgallery.cloud.huawei.com/appdl/<C-id> that 302-redirects
// to the real signed APK on its CDN. We follow the redirects, stream the APK to
// disk (files can be hundreds of MB), and then run the built-in APK SDK analyzer
// to surface SDKs / permissions / size.
//
// Best-effort metadata (app name, icon, developer) is additionally fetched from
// the public detail endpoint when it isn't gated — but the binary download no
// longer depends on it.
import { promises as fs, createWriteStream } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import path from "path";

const APPDL_BASE = "https://appgallery.cloud.huawei.com/appdl";

const BROWSER_UA =
  "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36";

export interface AppGalleryInfo {
  appStoreId: string | null;
  packageName: string | null;
  appName: string | null;
  versionName: string | null;
  developer: string | null;
  iconUrl: string | null;
  description: string | null;
  downloadUrl: string | null;
  raw: unknown;
}

export function parseAppGalleryUrl(input: string): { appStoreId: string | null } {
  const trimmed = input.trim();
  // Direct C-id
  const direct = trimmed.match(/\b(C\d{4,})\b/);
  if (direct) return { appStoreId: direct[1] };
  try {
    const u = new URL(trimmed);
    const fromQuery = u.searchParams.get("appid") || u.searchParams.get("appId");
    if (fromQuery) return { appStoreId: fromQuery };
    const m = u.pathname.match(/(C\d{4,})/);
    if (m) return { appStoreId: m[1] };
  } catch {
    /* not a URL */
  }
  return { appStoreId: null };
}

// Parse multiple links/ids from a blob of text (newline, comma or space separated).
export function parseAppGalleryUrls(input: string): string[] {
  const tokens = input
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const ids: string[] = [];
  for (const tok of tokens) {
    const { appStoreId } = parseAppGalleryUrl(tok);
    if (appStoreId && !ids.includes(appStoreId)) ids.push(appStoreId);
  }
  return ids;
}

// Pull the package + versionCode out of Huawei's CDN filename, e.g.
//   com.funplus.ts.huawei.2605262233.apk → { pkg: "com.funplus.ts.huawei", code: 2605262233 }
function parseCdnFileName(fileName: string): { packageName: string | null; versionCode: number | null } {
  const base = fileName.replace(/\.apk$/i, "");
  const m = base.match(/^(.*?)\.(\d+)$/);
  if (m) return { packageName: m[1], versionCode: Number(m[2]) };
  return { packageName: base || null, versionCode: null };
}

export interface AppGalleryDownload {
  apkPath: string;
  size: number;
  packageName: string | null;
  versionCode: number | null;
  cdnFileName: string | null;
  finalUrl: string;
}

// Resolve the redirect chain WITHOUT downloading the body, so we can learn the
// real filename (package + versionCode) and the content length cheaply.
export interface AppGalleryHead {
  ok: boolean;
  finalUrl: string | null;
  cdnFileName: string | null;
  packageName: string | null;
  versionCode: number | null;
  size: number | null;
  contentType: string | null;
  error?: string;
}

export async function headAppGalleryApk(appStoreId: string): Promise<AppGalleryHead> {
  const url = `${APPDL_BASE}/${encodeURIComponent(appStoreId)}`;
  try {
    // GET (not HEAD — Huawei's CDN rejects HEAD) but abort once headers arrive.
    const controller = new AbortController();
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": BROWSER_UA },
      signal: controller.signal,
    });
    const finalUrl = res.url || url;
    const contentType = res.headers.get("content-type");
    const lenHeader = res.headers.get("content-length");
    const size = lenHeader ? Number(lenHeader) : null;
    // We only needed the headers; cancel the (possibly huge) body.
    controller.abort();
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }

    const fileName = decodeURIComponent(finalUrl.split("/").pop()?.split("?")[0] ?? "");
    const isApk =
      (contentType ?? "").includes("android.package-archive") ||
      (contentType ?? "").includes("octet-stream") ||
      /\.apk$/i.test(fileName);
    if (!isApk) {
      return {
        ok: false,
        finalUrl,
        cdnFileName: fileName || null,
        packageName: null,
        versionCode: null,
        size,
        contentType,
        error: `AppGallery did not return an APK for ${appStoreId} (content-type: ${contentType ?? "unknown"}).`,
      };
    }
    const { packageName, versionCode } = parseCdnFileName(fileName);
    return { ok: true, finalUrl, cdnFileName: fileName || null, packageName, versionCode, size, contentType };
  } catch (err) {
    // AbortError after headers is expected; treat as benign only if we have nothing.
    const e = err as Error;
    if (e.name === "AbortError") {
      return { ok: false, finalUrl: null, cdnFileName: null, packageName: null, versionCode: null, size: null, contentType: null, error: "Request aborted before headers." };
    }
    return { ok: false, finalUrl: null, cdnFileName: null, packageName: null, versionCode: null, size: null, contentType: null, error: e.message };
  }
}

// Stream the APK to disk by following the appdl redirect chain.
export async function downloadAppGalleryApk(appStoreId: string, destDir: string): Promise<AppGalleryDownload> {
  const url = `${APPDL_BASE}/${encodeURIComponent(appStoreId)}`;
  const res = await fetch(url, { method: "GET", redirect: "follow", headers: { "User-Agent": BROWSER_UA } });
  if (!res.ok || !res.body) {
    throw new Error(`AppGallery download failed for ${appStoreId}: HTTP ${res.status}`);
  }
  const finalUrl = res.url || url;
  const contentType = res.headers.get("content-type") ?? "";
  const fileName = decodeURIComponent(finalUrl.split("/").pop()?.split("?")[0] ?? `${appStoreId}.apk`);
  const isApk =
    contentType.includes("android.package-archive") ||
    contentType.includes("octet-stream") ||
    /\.apk$/i.test(fileName);
  if (!isApk) {
    try {
      await res.body.cancel();
    } catch {
      /* ignore */
    }
    throw new Error(
      `AppGallery did not return an APK for ${appStoreId} (content-type: ${contentType || "unknown"}). ` +
        `The link may be a paid app, region-locked, or not publicly downloadable.`,
    );
  }

  await fs.mkdir(destDir, { recursive: true });
  const safeName = fileName.endsWith(".apk") ? fileName : `${appStoreId}.apk`;
  const apkPath = path.join(destDir, safeName);
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(apkPath));

  const stat = await fs.stat(apkPath);
  const { packageName, versionCode } = parseCdnFileName(fileName);
  return { apkPath, size: stat.size, packageName, versionCode, cdnFileName: fileName, finalUrl };
}

interface DetailResult {
  ok: boolean;
  info?: AppGalleryInfo;
  gated?: boolean;
  raw?: unknown;
}

async function tryDetailEndpoint(appStoreId: string, locale: string): Promise<DetailResult> {
  const url =
    `https://web-drcn.hispace.dbankcloud.cn/uowap/index?method=internal.getTabDetail` +
    `&serviceType=20&reqPageNum=1&maxResults=25&uri=${encodeURIComponent(`app|${appStoreId}`)}` +
    `&appid=${appStoreId}&zone=&locale=${locale}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
    });
  } catch (err) {
    return { ok: false, raw: { error: (err as Error).message } };
  }
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { ok: false, raw: text.slice(0, 300) };
  }
  if (json.rtnCode !== undefined && json.rtnCode !== 0) {
    return { ok: false, gated: true, raw: json };
  }
  const info = extractInfoFromDetail(json, appStoreId);
  if (info) return { ok: true, info, raw: json };
  return { ok: false, raw: json };
}

function extractInfoFromDetail(json: Record<string, unknown>, appStoreId: string): AppGalleryInfo | null {
  const layoutData = json.layoutData as Array<{ dataList?: Array<Record<string, unknown>> }> | undefined;
  if (!Array.isArray(layoutData)) return null;
  for (const layout of layoutData) {
    for (const item of layout.dataList ?? []) {
      const pkg = (item.package_ ?? item.pkgName ?? item.package) as string | undefined;
      const name = (item.name ?? item.appName) as string | undefined;
      if (pkg || name) {
        return {
          appStoreId,
          packageName: pkg ?? null,
          appName: name ?? null,
          versionName: ((item.versionName ?? item.version) as string | null) ?? null,
          developer: ((item.developerName ?? item.devName) as string | null) ?? null,
          iconUrl: ((item.icon ?? item.iconUrl) as string | null) ?? null,
          description: ((item.intro ?? item.briefDes ?? item.description) as string | null) ?? null,
          downloadUrl: ((item.downurl ?? item.downUrl ?? item.fullSizeDownUrl) as string | null) ?? null,
          raw: item,
        };
      }
    }
  }
  return null;
}

// Best-effort enrichment only. Never throws.
export async function fetchAppGalleryInfo(appStoreId: string): Promise<DetailResult> {
  for (const locale of ["en_US", "zh_CN"]) {
    try {
      const r = await tryDetailEndpoint(appStoreId, locale);
      if (r.ok) return r;
      if (r.gated) return r;
    } catch {
      /* try next locale */
    }
  }
  return { ok: false };
}

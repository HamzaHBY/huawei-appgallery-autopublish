// Fetch app info + (best-effort) APK binary from a public Huawei AppGallery link.
//
// IMPORTANT: Huawei gates its public store APIs (web-drcn / store-drcn) behind a
// signed "InterfaceCode" and the binary download link behind the device-side
// client API. So fully-automatic binary download from a public link is NOT
// guaranteed. This module:
//   1. Parses the C-id from a link like https://appgallery.huawei.com/app/C115313535
//   2. Tries several public detail endpoints to recover app metadata + a
//      download URL (`downurl`).
//   3. Downloads the APK if a usable URL is recovered.
// When the API is gated it returns a structured INFO_ONLY/FAILED result with a
// clear message instead of throwing — callers persist that for the UI.
import { promises as fs } from "fs";
import path from "path";

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
  const direct = trimmed.match(/\b(C\d{6,})\b/);
  if (direct) return { appStoreId: direct[1] };
  try {
    const u = new URL(trimmed);
    const fromQuery = u.searchParams.get("appid") || u.searchParams.get("appId");
    if (fromQuery) return { appStoreId: fromQuery };
    const m = u.pathname.match(/(C\d{6,})/);
    if (m) return { appStoreId: m[1] };
  } catch {
    /* not a URL */
  }
  return { appStoreId: null };
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
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
        Accept: "application/json",
      },
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
  // Gate response: { rtnCode: 1002, rtnDesc: "InterfaceCode Verification failed." }
  if (json.rtnCode !== undefined && json.rtnCode !== 0) {
    return { ok: false, gated: true, raw: json };
  }

  // Walk the layout tree to find the app card.
  const info = extractInfoFromDetail(json, appStoreId);
  if (info) return { ok: true, info, raw: json };
  return { ok: false, raw: json };
}

// The getTabDetail response nests cards under layoutData[].dataList[].
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
          versionName: (item.versionName ?? item.version) as string | null ?? null,
          developer: (item.developerName ?? item.devName) as string | null ?? null,
          iconUrl: (item.icon ?? item.iconUrl) as string | null ?? null,
          description: (item.intro ?? item.briefDes ?? item.description) as string | null ?? null,
          downloadUrl: (item.downurl ?? item.downUrl ?? item.fullSizeDownUrl) as string | null ?? null,
          raw: item,
        };
      }
    }
  }
  return null;
}

export async function fetchAppGalleryInfo(appStoreId: string): Promise<DetailResult> {
  for (const locale of ["en_US", "zh_CN"]) {
    const r = await tryDetailEndpoint(appStoreId, locale);
    if (r.ok) return r;
    if (r.gated) return r; // gating won't change by locale
  }
  return { ok: false };
}

export async function downloadApkTo(downloadUrl: string, destDir: string, fileName: string): Promise<{ apkPath: string; size: number }> {
  await fs.mkdir(destDir, { recursive: true });
  const res = await fetch(downloadUrl, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const apkPath = path.join(destDir, fileName.endsWith(".apk") ? fileName : `${fileName}.apk`);
  await fs.writeFile(apkPath, buf);
  return { apkPath, size: buf.byteLength };
}

export const APPGALLERY_GATED_MESSAGE =
  "Huawei now gates the public AppGallery store API behind a signed InterfaceCode, " +
  "so automatic binary download from a public link is not available. App metadata " +
  "could not be retrieved without it. For your own apps, upload the APK directly to " +
  "the Analyzer, or download it from AppGallery Connect.";

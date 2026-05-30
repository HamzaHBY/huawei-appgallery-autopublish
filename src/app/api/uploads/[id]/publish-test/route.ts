import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { prisma } from "@/lib/db";
import { huaweiClientFromEnv } from "@/lib/huawei-agc";
import { DEFAULT_LOCALE } from "@/lib/locales";

export const runtime = "nodejs";
export const maxDuration = 60;

type CheckStatus = "pass" | "fail" | "warn";
interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

// Server-side publish readiness test. Runs the full set of preconditions the
// publish step needs — including live Huawei OAuth + app access — WITHOUT
// submitting anything. Returns a checklist so issues can be fixed before the
// real publish.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const upload = await prisma.upload.findUnique({
    where: { id },
    include: { huaweiApp: true, localizations: true, screenshots: true },
  });
  if (!upload) return NextResponse.json({ error: "Upload not found" }, { status: 404 });

  const checks: Check[] = [];

  // 1. APK file present
  let apkOk = false;
  try {
    const st = await fs.stat(upload.apkPath);
    apkOk = st.size > 0;
    checks.push({
      name: "APK file",
      status: apkOk ? "pass" : "fail",
      detail: apkOk ? `${(st.size / 1024 / 1024).toFixed(1)} MB on disk` : "APK file is empty",
    });
  } catch {
    checks.push({ name: "APK file", status: "fail", detail: "APK file missing on disk" });
  }

  // 2. Parsed package name
  checks.push({
    name: "Package name",
    status: upload.packageName ? "pass" : "fail",
    detail: upload.packageName ?? "APK not parsed yet",
  });

  // 3. Linked AGC app (resolve by package if not linked)
  let appId: string | undefined = upload.huaweiApp?.agcAppId;
  if (appId) {
    checks.push({ name: "AGC app linked", status: "pass", detail: `App ID ${appId}` });
  } else if (upload.packageName) {
    try {
      const client = huaweiClientFromEnv();
      const map = await client.queryAppIdByPackage([upload.packageName]);
      appId = map.get(upload.packageName);
      checks.push({
        name: "AGC app linked",
        status: appId ? "warn" : "fail",
        detail: appId
          ? `Not linked yet, but resolvable by package → ${appId} (will auto-link)`
          : "No AGC app found for this package. Create it once in AppGallery Connect.",
      });
    } catch (err) {
      checks.push({ name: "AGC app linked", status: "fail", detail: `Lookup failed: ${(err as Error).message}` });
    }
  } else {
    checks.push({ name: "AGC app linked", status: "fail", detail: "No app linked and no package to resolve" });
  }

  // 4. Localizations
  const hasDefault = upload.localizations.some((l) => l.locale === DEFAULT_LOCALE);
  checks.push({
    name: "Localizations",
    status: hasDefault ? "pass" : "fail",
    detail: `${upload.localizations.length} locale(s)${hasDefault ? "" : ` (missing default ${DEFAULT_LOCALE})`}`,
  });

  // 5. Screenshots
  const shotCount = upload.screenshots.filter((s) => s.locale === DEFAULT_LOCALE).length;
  checks.push({
    name: "Screenshots",
    status: shotCount >= 1 ? "pass" : "warn",
    detail: `${shotCount} screenshot(s) for ${DEFAULT_LOCALE}`,
  });

  // 6. Huawei OAuth + app access (live, read-only)
  try {
    const client = huaweiClientFromEnv();
    await client.getAccessToken();
    checks.push({ name: "Huawei OAuth", status: "pass", detail: "Access token obtained" });
    if (appId) {
      try {
        await client.getAppInfo(appId);
        checks.push({ name: "AGC app access", status: "pass", detail: "app-info readable with current credentials" });
      } catch (err) {
        checks.push({ name: "AGC app access", status: "fail", detail: (err as Error).message });
      }
    }
  } catch (err) {
    checks.push({ name: "Huawei OAuth", status: "fail", detail: (err as Error).message });
  }

  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  const ready = failed === 0;
  return NextResponse.json({
    ready,
    summary: ready
      ? warned > 0
        ? `Ready to publish (${warned} warning(s))`
        : "Ready to publish"
      : `${failed} blocking issue(s) found`,
    checks,
  });
}

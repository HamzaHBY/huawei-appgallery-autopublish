// High-level workflow orchestration: turns a freshly-uploaded APK into a fully
// localized listing ready for user approval, then submits to Huawei.
import path from "path";
import { promises as fs } from "fs";
import { prisma } from "./db";
import { parseApk } from "./apk-parser";
import { generateMetadata, translateMetadata } from "./metadata-generator";
import { TARGET_LOCALES, DEFAULT_LOCALE, toHuaweiLocale } from "./locales";
import { generateScreenshots } from "./screenshots";
import { huaweiClientFromEnv } from "./huawei-agc";
import type { Upload } from "@prisma/client";

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

export function uploadAssetDir(uploadId: string) {
  return path.join(UPLOAD_DIR, uploadId);
}

async function logEvent(uploadId: string, level: string, message: string, data?: unknown) {
  await prisma.uploadEvent.create({
    data: { uploadId, level, message, data: (data ?? undefined) as never },
  });
}

async function setStatus(uploadId: string, patch: Partial<Pick<Upload, "status" | "currentStep" | "progress" | "errorMessage">>) {
  await prisma.upload.update({ where: { id: uploadId }, data: patch });
}

// ---------------------- Step 1: Parse APK ----------------------

export async function stepParseApk(uploadId: string) {
  const upload = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
  await setStatus(uploadId, { status: "PARSING_APK", currentStep: "parse-apk", progress: 10 });
  await logEvent(uploadId, "info", "Parsing APK");

  const assetDir = uploadAssetDir(uploadId);
  const parsed = await parseApk(upload.apkPath, assetDir);

  await prisma.upload.update({
    where: { id: uploadId },
    data: {
      packageName: parsed.packageName,
      versionName: parsed.versionName,
      versionCode: parsed.versionCode,
      minSdkVersion: parsed.minSdkVersion,
      targetSdkVersion: parsed.targetSdkVersion,
      permissions: parsed.permissions,
      iconPath: parsed.iconPngPath,
      apkLabel: parsed.label,
      apkSha256: parsed.sha256,
    },
  });
  await logEvent(uploadId, "info", `APK parsed: ${parsed.packageName} v${parsed.versionName}`);
  return parsed;
}

// ---------------------- Step 1b: Auto-link AGC app ----------------------

// APK-only flow: if the upload isn't linked to a HuaweiApp yet, resolve the
// AGC appId from the parsed package name via Huawei's appid-list API and
// link/reuse a HuaweiApp record. If the package isn't registered in the
// account yet, we log actionable guidance and leave it unlinked (publish will
// then fail with a clear message rather than silently).
export async function stepAutoLinkApp(uploadId: string) {
  const upload = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
  if (upload.huaweiAppId) return; // already linked
  const pkg = upload.packageName;
  if (!pkg) {
    await logEvent(uploadId, "warn", "No package name parsed; cannot auto-link AGC app");
    return;
  }

  await logEvent(uploadId, "info", `Resolving AGC appId for package ${pkg}`);
  let agcAppId: string | undefined;
  try {
    const client = huaweiClientFromEnv();
    const map = await client.queryAppIdByPackage([pkg]);
    agcAppId = map.get(pkg);
  } catch (err) {
    await logEvent(uploadId, "warn", `appid-list lookup failed: ${(err as Error).message}`);
  }

  if (!agcAppId) {
    await logEvent(
      uploadId,
      "warn",
      `No AGC app found for ${pkg}. Create the app once in AppGallery Connect (or link it in Settings); ` +
        `re-running will auto-link it. Huawei has no public API to create a new app.`,
    );
    return;
  }

  const app = await prisma.huaweiApp.upsert({
    where: { agcAppId },
    update: { packageName: pkg, displayName: upload.apkLabel ?? pkg },
    create: {
      agcAppId,
      packageName: pkg,
      displayName: upload.apkLabel ?? pkg,
      autoLinked: true,
    },
  });
  await prisma.upload.update({ where: { id: uploadId }, data: { huaweiAppId: app.id } });
  await logEvent(uploadId, "info", `Auto-linked to AGC app ${agcAppId}`);
}

// ---------------------- Step 2: Generate metadata ----------------------

export async function stepGenerateMetadata(uploadId: string) {
  await setStatus(uploadId, { status: "GENERATING_METADATA", currentStep: "metadata", progress: 25 });
  await logEvent(uploadId, "info", "Generating English metadata via GPT-4o");

  const upload = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
  const apk = {
    packageName: upload.packageName ?? "",
    versionName: upload.versionName ?? "1.0.0",
    versionCode: upload.versionCode ?? 1,
    minSdkVersion: upload.minSdkVersion ?? 21,
    targetSdkVersion: upload.targetSdkVersion ?? 33,
    permissions: upload.permissions,
    label: upload.apkLabel ?? upload.packageName ?? "App",
    iconPngPath: upload.iconPath,
    sha256: upload.apkSha256 ?? "",
  };

  const en = await generateMetadata(apk, DEFAULT_LOCALE, upload.metadataPrompt);
  await prisma.localization.upsert({
    where: { uploadId_locale: { uploadId, locale: DEFAULT_LOCALE } },
    update: en,
    create: { uploadId, locale: DEFAULT_LOCALE, ...en },
  });
  await logEvent(uploadId, "info", `English metadata generated: "${en.title}"`);
  return en;
}

// ---------------------- Step 3: Translate ----------------------

export async function stepTranslate(uploadId: string) {
  await setStatus(uploadId, { status: "TRANSLATING", currentStep: "translate", progress: 45 });
  const source = await prisma.localization.findUnique({
    where: { uploadId_locale: { uploadId, locale: DEFAULT_LOCALE } },
  });
  if (!source) throw new Error("Source English localization missing");

  for (const target of TARGET_LOCALES) {
    if (target.bcp47 === DEFAULT_LOCALE) continue;
    await logEvent(uploadId, "info", `Translating → ${target.bcp47}`);
    try {
      const translated = await translateMetadata(
        {
          title: source.title,
          shortDescription: source.shortDescription,
          description: source.description,
          keywords: source.keywords ?? "",
          whatsNew: source.whatsNew ?? "",
        },
        DEFAULT_LOCALE,
        target.bcp47,
      );
      await prisma.localization.upsert({
        where: { uploadId_locale: { uploadId, locale: target.bcp47 } },
        update: translated,
        create: { uploadId, locale: target.bcp47, ...translated },
      });
    } catch (err) {
      await logEvent(uploadId, "warn", `Translation to ${target.bcp47} failed: ${(err as Error).message}`);
    }
  }
}

// ---------------------- Step 4: Screenshots ----------------------

export async function stepGenerateScreenshots(uploadId: string) {
  await setStatus(uploadId, { status: "GENERATING_SCREENSHOTS", currentStep: "screenshots", progress: 70 });
  await logEvent(uploadId, "info", "Generating screenshots");

  const upload = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
  const en = await prisma.localization.findUnique({
    where: { uploadId_locale: { uploadId, locale: DEFAULT_LOCALE } },
  });

  const taglines = [
    en?.shortDescription ?? upload.apkLabel ?? "Discover something new",
    "Built for everyday use",
    "Beautifully simple",
    "Powerful features",
  ];

  const assetDir = path.join(uploadAssetDir(uploadId), "screenshots");
  const apk = {
    packageName: upload.packageName ?? "",
    versionName: upload.versionName ?? "1.0.0",
    versionCode: upload.versionCode ?? 1,
    minSdkVersion: upload.minSdkVersion ?? 21,
    targetSdkVersion: upload.targetSdkVersion ?? 33,
    permissions: upload.permissions,
    label: upload.apkLabel ?? "App",
    iconPngPath: upload.iconPath,
    sha256: upload.apkSha256 ?? "",
  };

  const source = (upload.screenshotSource ?? "vmos") as
    | "vmos"
    | "ai_openai"
    | "ai_gemini"
    | "template";
  await logEvent(uploadId, "info", `Screenshot source: ${source}`);
  const shots = await generateScreenshots(apk, upload.apkPath, assetDir, taglines, {
    uploadId,
    packageName: upload.packageName ?? undefined,
    source,
    onProgress: (msg) => logEvent(uploadId, "info", msg),
  });

  await prisma.screenshot.deleteMany({ where: { uploadId } });
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    await prisma.screenshot.create({
      data: {
        uploadId,
        locale: DEFAULT_LOCALE,
        path: s.path,
        width: s.width,
        height: s.height,
        ordering: i,
        source: s.source,
      },
    });
  }
  await logEvent(uploadId, "info", `Generated ${shots.length} screenshots (${shots[0]?.source ?? "n/a"})`);
}

// ---------------------- Step 5: Mark ready for review ----------------------

export async function stepReadyForReview(uploadId: string) {
  await setStatus(uploadId, { status: "PENDING_REVIEW", currentStep: "pending-review", progress: 85 });
  await logEvent(uploadId, "info", "Ready for user review");
}

// ---------------------- Step 6: Publish to Huawei ----------------------

export async function stepPublishToHuawei(uploadId: string) {
  const upload = await prisma.upload.findUniqueOrThrow({
    where: { id: uploadId },
    include: { huaweiApp: true, localizations: true, screenshots: true },
  });
  if (!upload.huaweiApp) throw new Error("HuaweiApp not linked to upload");
  if (!upload.approvedAt) throw new Error("Upload not approved by user");

  await setStatus(uploadId, { status: "UPLOADING_TO_HUAWEI", currentStep: "huawei-upload", progress: 88 });
  const client = huaweiClientFromEnv();
  const appId = upload.huaweiApp.agcAppId;

  // Upload APK
  await logEvent(uploadId, "info", "Requesting upload URL for APK");
  const apkSlot = await client.getUploadUrl(appId, "apk");
  await logEvent(uploadId, "info", "Uploading APK to Huawei CDN");
  const apkFile = await client.uploadFile(upload.apkPath, apkSlot.uploadUrl, apkSlot.authCode);
  await client.updateAppFile(appId, apkFile.fileDestUrl, apkFile.size, path.basename(upload.apkPath));

  // App-level info
  await client.updateAppInfo(appId, {
    defaultLang: toHuaweiLocale(DEFAULT_LOCALE),
    categoryId: upload.huaweiApp.category,
  });

  // Per-locale text
  for (const loc of upload.localizations) {
    await logEvent(uploadId, "info", `Pushing localization ${loc.locale}`);
    await client.updateLanguageInfo(appId, toHuaweiLocale(loc.locale), {
      appName: loc.title,
      appDesc: loc.description,
      briefInfo: loc.shortDescription,
      keywords: loc.keywords ?? undefined,
      newFeatures: loc.whatsNew ?? undefined,
    });
    await prisma.localization.update({
      where: { id: loc.id },
      data: { uploadedToHuaweiAt: new Date() },
    });
  }

  // Screenshots (English first; Huawei will inherit if other langs missing imgs)
  const englishShots = upload.screenshots.filter((s) => s.locale === DEFAULT_LOCALE);
  if (englishShots.length > 0) {
    const uploaded: Array<{ fileDestUrl: string; fileName: string; size: string }> = [];
    for (const shot of englishShots) {
      const slot = await client.getUploadUrl(appId, "png");
      const file = await client.uploadFile(shot.path, slot.uploadUrl, slot.authCode);
      uploaded.push({ fileDestUrl: file.fileDestUrl, fileName: path.basename(shot.path), size: file.size });
      await prisma.screenshot.update({
        where: { id: shot.id },
        data: { uploadedToHuaweiAt: new Date() },
      });
    }
    await client.updateAppImage(appId, toHuaweiLocale(DEFAULT_LOCALE), "screenshot", uploaded);
  }

  // Submit
  await logEvent(uploadId, "info", "Submitting for review");
  await client.submitForReview(appId);

  await setStatus(uploadId, { status: "SUBMITTED", currentStep: "submitted", progress: 100 });
  await logEvent(uploadId, "info", "Successfully submitted to Huawei AppGallery");
}

// ---------------------- Orchestrator (called by worker) ----------------------

export async function runPreparationPipeline(uploadId: string) {
  try {
    await stepParseApk(uploadId);
    await stepAutoLinkApp(uploadId);
    await stepGenerateMetadata(uploadId);
    await stepTranslate(uploadId);
    await stepGenerateScreenshots(uploadId);
    await stepReadyForReview(uploadId);
  } catch (err) {
    const message = (err as Error).message;
    await setStatus(uploadId, { status: "FAILED", errorMessage: message });
    await logEvent(uploadId, "error", `Pipeline failed: ${message}`);
    throw err;
  }
}

export async function publishApprovedUpload(uploadId: string) {
  try {
    await stepPublishToHuawei(uploadId);
  } catch (err) {
    const message = (err as Error).message;
    await setStatus(uploadId, { status: "FAILED", errorMessage: message });
    await logEvent(uploadId, "error", `Publish failed: ${message}`);
    throw err;
  }
}

// Touch fs import to avoid unused warning if reorganized later
void fs;

import { NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import { prisma } from "@/lib/db";
import {
  parseAppGalleryUrl,
  parseAppGalleryUrls,
  downloadAppGalleryApk,
  fetchAppGalleryInfo,
} from "@/lib/appgallery";
import { analyzeApk } from "@/lib/apk-analyzer";

export const runtime = "nodejs";
// Large game APKs can take a while to stream + analyze.
export const maxDuration = 600;

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

type FetchRow = { apkSize: bigint | null } & Record<string, unknown>;

function serialize(f: FetchRow) {
  return { ...f, apkSize: f.apkSize != null ? f.apkSize.toString() : null };
}

export async function GET() {
  const fetches = await prisma.appGalleryFetch.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ fetches: fetches.map(serialize) });
}

// Accepts either { url } (single) or { urls } / { url: "multi-line blob" } (bulk).
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { url?: string; urls?: string[] };

  // Collect C-ids from every supported input shape.
  const ids = new Set<string>();
  if (Array.isArray(body.urls)) {
    for (const u of body.urls) {
      const { appStoreId } = parseAppGalleryUrl(u);
      if (appStoreId) ids.add(appStoreId);
    }
  }
  if (typeof body.url === "string") {
    for (const id of parseAppGalleryUrls(body.url)) ids.add(id);
  }

  if (ids.size === 0) {
    return NextResponse.json(
      { error: "Could not extract any AppGallery C-id (e.g. C115313535) from the input." },
      { status: 400 },
    );
  }

  const results = [];
  for (const appStoreId of ids) {
    results.push(await processOne(appStoreId));
  }
  return NextResponse.json({ fetches: results.map(serialize) });
}

async function processOne(appStoreId: string): Promise<FetchRow> {
  const row = await prisma.appGalleryFetch.create({
    data: { sourceUrl: appStoreId, appStoreId, status: "PENDING" },
  });

  // Kick off best-effort metadata enrichment in parallel with the download.
  const infoPromise = fetchAppGalleryInfo(appStoreId).catch(() => ({ ok: false as const }));

  try {
    const dest = path.join(UPLOAD_DIR, "appgallery", row.id);
    const dl = await downloadAppGalleryApk(appStoreId, dest);

    // Analyze the downloaded APK (SDKs, permissions, parsed manifest).
    const analysis = await analyzeApk(dl.apkPath, dest);

    const detail = await infoPromise;
    const info = detail.ok && detail.info ? detail.info : null;

    const updated = await prisma.appGalleryFetch.update({
      where: { id: row.id },
      data: {
        packageName: analysis.apk.packageName ?? dl.packageName ?? info?.packageName ?? null,
        appName: analysis.apk.label ?? info?.appName ?? null,
        label: analysis.apk.label ?? null,
        versionName: analysis.apk.versionName ?? info?.versionName ?? null,
        versionCode: analysis.apk.versionCode ?? dl.versionCode ?? null,
        minSdkVersion: analysis.apk.minSdkVersion ?? null,
        targetSdkVersion: analysis.apk.targetSdkVersion ?? null,
        permissions: analysis.apk.permissions ?? [],
        nativeAbis: analysis.nativeAbis ?? [],
        fileCount: analysis.fileCount ?? null,
        sdks: analysis.sdks as never,
        developer: info?.developer ?? null,
        iconUrl: info?.iconUrl ?? null,
        description: info?.description ?? null,
        apkPath: dl.apkPath,
        apkSize: BigInt(dl.size),
        status: "DOWNLOADED",
        rawDetail: (info?.raw ?? null) as never,
      },
    });
    return updated;
  } catch (err) {
    const updated = await prisma.appGalleryFetch.update({
      where: { id: row.id },
      data: { status: "FAILED", errorMessage: (err as Error).message },
    });
    return updated;
  }
}

// Auto-delete the stored APK for a fetch (used by cleanup + manual delete).
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const row = await prisma.appGalleryFetch.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.apkPath) {
    await fs.rm(row.apkPath, { force: true }).catch(() => {});
  }
  const updated = await prisma.appGalleryFetch.update({
    where: { id },
    data: { apkPath: null, apkDeletedAt: new Date() },
  });
  return NextResponse.json(serialize(updated));
}

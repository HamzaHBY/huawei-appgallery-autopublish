import { NextResponse } from "next/server";
import path from "path";
import { prisma } from "@/lib/db";
import {
  parseAppGalleryUrl,
  fetchAppGalleryInfo,
  downloadApkTo,
  APPGALLERY_GATED_MESSAGE,
} from "@/lib/appgallery";

export const runtime = "nodejs";
export const maxDuration = 120;

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

export async function GET() {
  const fetches = await prisma.appGalleryFetch.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({
    fetches: fetches.map((f) => ({ ...f, apkSize: f.apkSize ? f.apkSize.toString() : null })),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { url?: string };
  const url = (body.url ?? "").trim();
  if (!url) return NextResponse.json({ error: "Missing 'url'" }, { status: 400 });

  const { appStoreId } = parseAppGalleryUrl(url);
  const row = await prisma.appGalleryFetch.create({
    data: { sourceUrl: url, appStoreId, status: "PENDING" },
  });

  if (!appStoreId) {
    const updated = await prisma.appGalleryFetch.update({
      where: { id: row.id },
      data: { status: "FAILED", errorMessage: "Could not extract a C-id (e.g. C115313535) from the link." },
    });
    return NextResponse.json(serialize(updated), { status: 400 });
  }

  const detail = await fetchAppGalleryInfo(appStoreId);
  if (!detail.ok || !detail.info) {
    const updated = await prisma.appGalleryFetch.update({
      where: { id: row.id },
      data: {
        status: "FAILED",
        errorMessage: detail.gated ? APPGALLERY_GATED_MESSAGE : "App info could not be retrieved from AppGallery.",
        rawDetail: (detail.raw ?? null) as never,
      },
    });
    return NextResponse.json(serialize(updated), { status: 200 });
  }

  const info = detail.info;
  // Try to download the binary if a URL was exposed.
  let apkPath: string | null = null;
  let apkSize: bigint | null = null;
  let status = "INFO_ONLY";
  let errorMessage: string | null = null;
  if (info.downloadUrl) {
    try {
      const dest = path.join(UPLOAD_DIR, "appgallery", row.id);
      const dl = await downloadApkTo(info.downloadUrl, dest, info.packageName ?? appStoreId);
      apkPath = dl.apkPath;
      apkSize = BigInt(dl.size);
      status = "DOWNLOADED";
    } catch (err) {
      errorMessage = `Info fetched, but download failed: ${(err as Error).message}`;
    }
  } else {
    errorMessage = "Info fetched, but Huawei did not expose a direct download URL for this app.";
  }

  const updated = await prisma.appGalleryFetch.update({
    where: { id: row.id },
    data: {
      packageName: info.packageName,
      appName: info.appName,
      versionName: info.versionName,
      developer: info.developer,
      iconUrl: info.iconUrl,
      description: info.description,
      apkPath,
      apkSize,
      status,
      errorMessage,
      rawDetail: (info.raw ?? null) as never,
    },
  });
  return NextResponse.json(serialize(updated));
}

function serialize(f: { apkSize: bigint | null } & Record<string, unknown>) {
  return { ...f, apkSize: f.apkSize ? f.apkSize.toString() : null };
}

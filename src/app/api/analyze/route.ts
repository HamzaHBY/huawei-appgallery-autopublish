import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { analyzeApk } from "@/lib/apk-analyzer";

export const runtime = "nodejs";
export const maxDuration = 120;

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

export async function GET() {
  const analyses = await prisma.apkAnalysis.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({
    analyses: analyses.map((a) => ({ ...a, apkSize: a.apkSize ? a.apkSize.toString() : null })),
  });
}

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".apk")) {
    return NextResponse.json({ error: "Only .apk files are accepted" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());

  // Persist a row first so we have an id-scoped working dir.
  const row = await prisma.apkAnalysis.create({
    data: { source: "upload", filename: file.name, apkSize: BigInt(buf.byteLength) },
  });
  const dir = path.join(UPLOAD_DIR, "analysis", row.id);
  await fs.mkdir(dir, { recursive: true });
  const apkPath = path.join(dir, file.name);
  await fs.writeFile(apkPath, buf);

  try {
    const result = await analyzeApk(apkPath, dir);
    const updated = await prisma.apkAnalysis.update({
      where: { id: row.id },
      data: {
        apkPath,
        packageName: result.apk.packageName,
        versionName: result.apk.versionName,
        versionCode: result.apk.versionCode,
        minSdkVersion: result.apk.minSdkVersion,
        targetSdkVersion: result.apk.targetSdkVersion,
        label: result.apk.label,
        iconPath: result.apk.iconPngPath ?? null,
        permissions: result.apk.permissions,
        sdks: result.sdks as never,
        details: {
          fileCount: result.fileCount,
          dexCount: result.dexCount,
          nativeAbis: result.nativeAbis,
          totalUncompressed: result.totalUncompressed,
        } as never,
      },
    });
    return NextResponse.json({
      id: updated.id,
      apk: result.apk,
      sdks: result.sdks,
      fileCount: result.fileCount,
      dexCount: result.dexCount,
      nativeAbis: result.nativeAbis,
      totalUncompressed: result.totalUncompressed,
    });
  } catch (err) {
    await prisma.apkAnalysis.update({
      where: { id: row.id },
      data: { details: { error: (err as Error).message } as never },
    });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

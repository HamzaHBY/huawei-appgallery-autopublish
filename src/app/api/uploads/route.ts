import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

export async function GET() {
  const uploads = await prisma.upload.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { huaweiApp: true },
  });
  // apkSize is a BigInt column — NextResponse.json can't serialize BigInt.
  const serialized = uploads.map((u) => ({
    ...u,
    apkSize: u.apkSize != null ? u.apkSize.toString() : null,
  }));
  return NextResponse.json({ uploads: serialized });
}

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const huaweiAppId = (form.get("huaweiAppId") ?? null) as string | null;
  const metadataPrompt = ((form.get("metadataPrompt") as string | null) ?? "").trim() || null;
  const screenshotPrompt = ((form.get("screenshotPrompt") as string | null) ?? "").trim() || null;
  const rawSource = ((form.get("screenshotSource") as string | null) ?? "vmos").trim();
  const screenshotSource = ["vmos", "ai_openai", "ai_gemini", "template"].includes(rawSource)
    ? rawSource
    : "vmos";
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".apk")) {
    return NextResponse.json({ error: "Only .apk files are accepted" }, { status: 400 });
  }
  if (huaweiAppId) {
    const exists = await prisma.huaweiApp.findUnique({ where: { id: huaweiAppId } });
    if (!exists) return NextResponse.json({ error: "Unknown huaweiAppId" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const sha = crypto.createHash("sha256").update(buf).digest("hex");

  const upload = await prisma.upload.create({
    data: {
      huaweiAppId,
      filename: file.name,
      apkPath: "",
      apkSize: BigInt(buf.byteLength),
      apkSha256: sha,
      metadataPrompt,
      screenshotPrompt,
      screenshotSource,
      autoCreateApp: !huaweiAppId,
    },
  });

  const dir = path.join(UPLOAD_DIR, upload.id);
  await fs.mkdir(dir, { recursive: true });
  const apkPath = path.join(dir, file.name);
  await fs.writeFile(apkPath, buf);

  await prisma.upload.update({ where: { id: upload.id }, data: { apkPath } });
  await prisma.job.create({
    data: { uploadId: upload.id, kind: "PARSE_APK", status: "QUEUED" },
  });
  await prisma.uploadEvent.create({
    data: { uploadId: upload.id, level: "info", message: "Upload received; queued for parsing" },
  });

  return NextResponse.json({ id: upload.id });
}

// Exposes the uploaded APK as a publicly downloadable URL so external services
// (e.g. VMOS Cloud, Appetize) can pull it during screenshot capture. The path
// is intentionally unguessable (uploadId is a cuid) and the route is read-only.
import { NextResponse } from "next/server";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const upload = await prisma.upload.findUnique({ where: { id } });
  if (!upload || !upload.apkPath) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const info = await stat(upload.apkPath);
    const stream = createReadStream(upload.apkPath);
    const webStream = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
    return new NextResponse(webStream, {
      headers: {
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Length": String(info.size),
        "Content-Disposition": `attachment; filename="${upload.filename}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "APK file missing on disk" }, { status: 404 });
  }
}

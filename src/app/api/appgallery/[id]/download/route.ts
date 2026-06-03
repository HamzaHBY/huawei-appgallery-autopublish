// Streams a downloaded AppGallery APK to the user's browser and records the
// download timestamp so the auto-cleanup job knows to keep it.
import { NextResponse } from "next/server";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await prisma.appGalleryFetch.findUnique({ where: { id } });
  if (!row || !row.apkPath) {
    return NextResponse.json(
      { error: row?.apkDeletedAt ? "APK was auto-deleted to free space. Fetch it again." : "Not found" },
      { status: 404 },
    );
  }
  try {
    const info = await stat(row.apkPath);
    const stream = createReadStream(row.apkPath);
    const webStream = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
    const fileName = `${row.packageName ?? row.appStoreId ?? "app"}.apk`;
    await prisma.appGalleryFetch.update({
      where: { id },
      data: { downloadedByUserAt: new Date() },
    });
    return new NextResponse(webStream, {
      headers: {
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Length": String(info.size),
        "Content-Disposition": `attachment; filename="${path.basename(fileName)}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "APK file missing on disk" }, { status: 404 });
  }
}

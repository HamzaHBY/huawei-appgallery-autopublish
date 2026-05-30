import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const upload = await prisma.upload.findUnique({
    where: { id },
    include: {
      huaweiApp: true,
      localizations: { orderBy: { locale: "asc" } },
      screenshots: { orderBy: { ordering: "asc" } },
      events: { orderBy: { createdAt: "desc" }, take: 50 },
      jobs: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!upload) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Coerce BigInt for JSON serialization.
  const safe = {
    ...upload,
    apkSize: upload.apkSize.toString(),
  };
  return NextResponse.json({ upload: safe });
}

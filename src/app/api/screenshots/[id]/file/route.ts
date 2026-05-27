import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shot = await prisma.screenshot.findUnique({ where: { id } });
  if (!shot) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const buf = await fs.readFile(shot.path);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "File missing" }, { status: 404 });
  }
}

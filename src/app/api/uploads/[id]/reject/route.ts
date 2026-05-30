import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const upload = await prisma.upload.findUnique({ where: { id } });
  if (!upload) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.upload.update({
    where: { id },
    data: { status: "REJECTED_BY_USER" },
  });
  await prisma.uploadEvent.create({
    data: { uploadId: id, level: "warn", message: "Rejected by user" },
  });
  return NextResponse.json({ ok: true });
}

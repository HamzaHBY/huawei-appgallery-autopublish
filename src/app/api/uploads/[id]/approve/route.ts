import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const upload = await prisma.upload.findUnique({ where: { id } });
  if (!upload) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (upload.status !== "PENDING_REVIEW") {
    return NextResponse.json(
      { error: `Upload is in ${upload.status}, not PENDING_REVIEW` },
      { status: 409 },
    );
  }
  await prisma.upload.update({
    where: { id },
    data: { approvedAt: new Date(), status: "UPLOADING_TO_HUAWEI", currentStep: "uploading" },
  });
  await prisma.job.create({
    data: { uploadId: id, kind: "PUBLISH_TO_HUAWEI", status: "QUEUED" },
  });
  await prisma.uploadEvent.create({
    data: { uploadId: id, level: "info", message: "Approved by user; queued for Huawei submission" },
  });
  return NextResponse.json({ ok: true });
}

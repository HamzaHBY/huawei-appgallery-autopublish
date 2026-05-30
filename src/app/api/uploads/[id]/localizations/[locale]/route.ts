import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

export const runtime = "nodejs";

const PatchSchema = z.object({
  title: z.string().min(1).max(64).optional(),
  shortDescription: z.string().min(1).max(80).optional(),
  description: z.string().min(1).max(4000).optional(),
  keywords: z.string().max(500).optional(),
  whatsNew: z.string().max(500).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; locale: string }> },
) {
  const { id, locale } = await params;
  const body = await req.json();
  const patch = PatchSchema.parse(body);
  const updated = await prisma.localization.update({
    where: { uploadId_locale: { uploadId: id, locale } },
    data: patch,
  });
  await prisma.uploadEvent.create({
    data: { uploadId: id, level: "info", message: `User edited ${locale} listing` },
  });
  return NextResponse.json({ localization: updated });
}

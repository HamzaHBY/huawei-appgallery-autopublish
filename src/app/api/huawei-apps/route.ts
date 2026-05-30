import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

export const runtime = "nodejs";

const NewAppSchema = z.object({
  agcAppId: z.string().min(1),
  packageName: z.string().min(1),
  displayName: z.string().min(1),
  category: z.number().int().min(1).max(50).default(2),
  defaultLocale: z.string().default("en-US"),
});

export async function POST(req: Request) {
  const body = await req.json();
  const data = NewAppSchema.parse(body);
  const app = await prisma.huaweiApp.create({ data });
  return NextResponse.json({ app });
}

export async function GET() {
  const apps = await prisma.huaweiApp.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ apps });
}

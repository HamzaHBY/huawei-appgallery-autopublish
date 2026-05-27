import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { UploadReview } from "@/components/UploadReview";

export const dynamic = "force-dynamic";

export default async function UploadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const upload = await prisma.upload.findUnique({
    where: { id },
    include: {
      huaweiApp: true,
      localizations: { orderBy: { locale: "asc" } },
      screenshots: { orderBy: { ordering: "asc" } },
      events: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!upload) notFound();

  const serializable = {
    id: upload.id,
    filename: upload.filename,
    status: upload.status,
    progress: upload.progress,
    packageName: upload.packageName,
    versionName: upload.versionName,
    apkLabel: upload.apkLabel,
    errorMessage: upload.errorMessage,
    approvedAt: upload.approvedAt ? upload.approvedAt.toISOString() : null,
    huaweiApp: upload.huaweiApp
      ? { displayName: upload.huaweiApp.displayName, agcAppId: upload.huaweiApp.agcAppId }
      : null,
    localizations: upload.localizations.map((l) => ({
      id: l.id,
      locale: l.locale,
      title: l.title,
      shortDescription: l.shortDescription,
      description: l.description,
      keywords: l.keywords,
      whatsNew: l.whatsNew,
    })),
    screenshots: upload.screenshots.map((s) => ({
      id: s.id,
      width: s.width,
      height: s.height,
      source: s.source,
    })),
    events: upload.events.map((e) => ({
      id: e.id,
      level: e.level,
      message: e.message,
      createdAt: e.createdAt.toISOString(),
    })),
  };

  return <UploadReview upload={serializable} />;
}

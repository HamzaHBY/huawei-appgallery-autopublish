// Auto-cleanup of downloaded AppGallery APKs.
//
// Requirement: if an APK fetched from AppGallery isn't downloaded (by the user)
// within ~2 days, delete the binary from the server to free space. We keep the
// metadata/analysis row — only the (potentially huge) .apk file is removed.
import { promises as fs } from "fs";
import { prisma } from "./db";

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

export async function cleanupExpiredAppGalleryApks(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - TWO_DAYS_MS);

  // Rows that still have an APK on disk, were created before the cutoff, and
  // were never downloaded by the user.
  const candidates = await prisma.appGalleryFetch.findMany({
    where: {
      apkPath: { not: null },
      createdAt: { lt: cutoff },
      downloadedByUserAt: null,
    },
    select: { id: true, apkPath: true },
  });

  let removed = 0;
  for (const row of candidates) {
    if (!row.apkPath) continue;
    try {
      await fs.rm(row.apkPath, { force: true });
    } catch {
      /* file may already be gone */
    }
    await prisma.appGalleryFetch.update({
      where: { id: row.id },
      data: { apkPath: null, apkDeletedAt: now },
    });
    removed++;
  }
  return removed;
}

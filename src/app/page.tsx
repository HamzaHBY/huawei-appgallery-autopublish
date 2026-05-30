import { prisma } from "@/lib/db";
import Link from "next/link";
import { UploadDropzone } from "@/components/UploadDropzone";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [apps, uploads] = await Promise.all([
    prisma.huaweiApp.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.upload.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { huaweiApp: true },
    }),
  ]);

  const t = await getTranslations();

  return (
    <div className="space-y-8">
      <section className="rounded-xl bg-gradient-to-r from-brand to-brand-dark p-8 text-white shadow">
        <h1 className="text-3xl font-bold">{t("app.title")}</h1>
        <p className="mt-2 max-w-2xl text-white/90">{t("app.tagline")}</p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Link href="/analyze" className="card transition-colors hover:border-brand">
          <h3 className="font-semibold">APK SDK Analyzer →</h3>
          <p className="mt-1 text-sm text-neutral-500">Upload any APK to list embedded SDKs and full app info.</p>
        </Link>
        <Link href="/appgallery" className="card transition-colors hover:border-brand">
          <h3 className="font-semibold">Fetch from AppGallery →</h3>
          <p className="mt-1 text-sm text-neutral-500">Paste an AppGallery link to fetch app info + download the APK.</p>
        </Link>
        <Link href="/settings" className="card transition-colors hover:border-brand">
          <h3 className="font-semibold">Settings →</h3>
          <p className="mt-1 text-sm text-neutral-500">Manage registered apps and credentials.</p>
        </Link>
      </section>

      <section className="card">
        <h2 className="mb-4 text-lg font-semibold">{t("dashboard.uploadApkCta")}</h2>
        <UploadDropzone apps={apps.map((a) => ({ id: a.id, displayName: a.displayName, packageName: a.packageName }))} />
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">Recent uploads</h2>
        {uploads.length === 0 ? (
          <p className="text-sm text-neutral-500">{t("dashboard.emptyState")}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-neutral-600">
                <tr>
                  <th className="px-4 py-2">App</th>
                  <th className="px-4 py-2">Version</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Progress</th>
                  <th className="px-4 py-2">Created</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {uploads.map((u) => (
                  <tr key={u.id} className="border-t border-neutral-100">
                    <td className="px-4 py-3">
                      <div className="font-medium">{u.apkLabel ?? u.filename}</div>
                      <div className="text-xs text-neutral-500">{u.packageName ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3">{u.versionName ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs">
                        {t(`dashboard.stepLabels.${u.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-2 w-32 rounded-full bg-neutral-100">
                        <div
                          className="h-2 rounded-full bg-brand"
                          style={{ width: `${u.progress}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-500">
                      {new Date(u.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/uploads/${u.id}`}
                        className="text-brand hover:underline"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

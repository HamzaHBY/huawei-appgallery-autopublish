"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { TARGET_LOCALES } from "@/lib/locales";

type Localization = {
  id: string;
  locale: string;
  title: string;
  shortDescription: string;
  description: string;
  keywords: string | null;
  whatsNew: string | null;
};

type UploadData = {
  id: string;
  filename: string;
  status: string;
  progress: number;
  packageName: string | null;
  versionName: string | null;
  apkLabel: string | null;
  errorMessage: string | null;
  approvedAt: string | null;
  huaweiApp: { displayName: string; agcAppId: string } | null;
  localizations: Localization[];
  screenshots: Array<{ id: string; width: number; height: number; source: string }>;
  events: Array<{ id: string; level: string; message: string; createdAt: string }>;
};

const PENDING_STATUSES = new Set([
  "QUEUED",
  "PARSING_APK",
  "GENERATING_METADATA",
  "GENERATING_SCREENSHOTS",
  "TRANSLATING",
  "UPLOADING_TO_HUAWEI",
]);

export function UploadReview({ upload: initial }: { upload: UploadData }) {
  const router = useRouter();
  const t = useTranslations();
  const [upload, setUpload] = useState<UploadData>(initial);
  const [activeLocale, setActiveLocale] = useState(initial.localizations[0]?.locale ?? "en-US");
  const [busy, setBusy] = useState(false);

  // Auto-refresh while pipeline is running
  useEffect(() => {
    if (!PENDING_STATUSES.has(upload.status)) return;
    const id = setInterval(async () => {
      const r = await fetch(`/api/uploads/${upload.id}`);
      if (r.ok) {
        const json = await r.json();
        setUpload({
          ...upload,
          status: json.upload.status,
          progress: json.upload.progress,
          packageName: json.upload.packageName,
          versionName: json.upload.versionName,
          apkLabel: json.upload.apkLabel,
          errorMessage: json.upload.errorMessage,
          approvedAt: json.upload.approvedAt,
          localizations: json.upload.localizations,
          screenshots: json.upload.screenshots,
          events: json.upload.events,
        });
      }
    }, 3000);
    return () => clearInterval(id);
  }, [upload]);

  const active = upload.localizations.find((l) => l.locale === activeLocale);

  type Check = { name: string; status: "pass" | "fail" | "warn"; detail: string };
  const [testResult, setTestResult] = useState<{ ready: boolean; summary: string; checks: Check[] } | null>(null);
  const [testing, setTesting] = useState(false);

  async function runPublishTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/uploads/${upload.id}/publish-test`, { method: "POST" });
      const json = await res.json();
      if (res.ok) setTestResult(json);
      else setTestResult({ ready: false, summary: json.error ?? "Test failed", checks: [] });
    } catch (e) {
      setTestResult({ ready: false, summary: (e as Error).message, checks: [] });
    } finally {
      setTesting(false);
    }
  }

  async function saveLocalization(patch: Partial<Localization>) {
    if (!active) return;
    setBusy(true);
    const res = await fetch(`/api/uploads/${upload.id}/localizations/${active.locale}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusy(false);
    if (res.ok) {
      const json = await res.json();
      setUpload({
        ...upload,
        localizations: upload.localizations.map((l) =>
          l.id === json.localization.id ? { ...l, ...json.localization } : l,
        ),
      });
    }
  }

  async function approve() {
    setBusy(true);
    const res = await fetch(`/api/uploads/${upload.id}/approve`, { method: "POST" });
    setBusy(false);
    if (res.ok) router.refresh();
    else alert(`Approve failed: ${await res.text()}`);
  }

  async function reject() {
    setBusy(true);
    const res = await fetch(`/api/uploads/${upload.id}/reject`, { method: "POST" });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{upload.apkLabel ?? upload.filename}</h1>
            <p className="text-sm text-neutral-500">
              {upload.packageName ?? "—"} · v{upload.versionName ?? "?"}
            </p>
            {upload.huaweiApp && (
              <p className="text-xs text-neutral-400">
                Target: {upload.huaweiApp.displayName} (AGC {upload.huaweiApp.agcAppId})
              </p>
            )}
          </div>
          <div className="text-right">
            <span className="inline-flex rounded-full bg-neutral-100 px-3 py-1 text-sm">
              {t(`dashboard.stepLabels.${upload.status}` as Parameters<typeof t>[0])}
            </span>
            <div className="mt-2 h-2 w-48 rounded-full bg-neutral-100">
              <div
                className="h-2 rounded-full bg-brand transition-all"
                style={{ width: `${upload.progress}%` }}
              />
            </div>
          </div>
        </div>
        {upload.errorMessage && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {upload.errorMessage}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section className="card">
            <h2 className="mb-4 text-lg font-semibold">{t("review.heading")}</h2>
            {upload.localizations.length === 0 ? (
              <p className="text-sm text-neutral-500">
                Metadata is still being generated…
              </p>
            ) : (
              <>
                <div className="mb-4 flex flex-wrap gap-1 border-b border-neutral-200">
                  {TARGET_LOCALES.filter((tl) =>
                    upload.localizations.some((l) => l.locale === tl.bcp47),
                  ).map((tl) => (
                    <button
                      key={tl.bcp47}
                      onClick={() => setActiveLocale(tl.bcp47)}
                      className={`px-3 py-1.5 text-sm ${
                        activeLocale === tl.bcp47
                          ? "border-b-2 border-brand text-brand"
                          : "text-neutral-600 hover:text-neutral-900"
                      }`}
                    >
                      {tl.label} <span className="text-xs text-neutral-400">{tl.bcp47}</span>
                    </button>
                  ))}
                </div>
                {active && (
                  <LocalizationEditor
                    key={active.id}
                    initial={active}
                    onSave={saveLocalization}
                    busy={busy}
                  />
                )}
              </>
            )}
          </section>

          <section className="card">
            <h2 className="mb-4 text-lg font-semibold">Screenshots</h2>
            {upload.screenshots.length === 0 ? (
              <p className="text-sm text-neutral-500">Generating…</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {upload.screenshots.map((s) => (
                  <div key={s.id} className="overflow-hidden rounded border bg-neutral-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/screenshots/${s.id}/file`}
                      alt="screenshot"
                      className="aspect-[9/16] w-full object-cover"
                    />
                    <div className="border-t p-1 text-xs text-neutral-500">{s.source}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <div className="card">
            <h3 className="mb-2 font-semibold">Actions</h3>
            <div className="flex flex-col gap-2">
              <button
                disabled={busy || upload.status !== "PENDING_REVIEW"}
                onClick={approve}
                className="btn btn-primary disabled:opacity-50"
              >
                {t("review.approveButton")}
              </button>
              <button
                disabled={busy || upload.status !== "PENDING_REVIEW"}
                onClick={reject}
                className="btn btn-danger disabled:opacity-50"
              >
                {t("review.rejectButton")}
              </button>
              <button
                disabled={testing}
                onClick={runPublishTest}
                className="btn btn-secondary disabled:opacity-50"
              >
                {testing ? "Testing…" : "Run publish test"}
              </button>
            </div>

            {testResult && (
              <div className="mt-3 space-y-2">
                <div
                  className={`rounded px-2 py-1 text-sm font-medium ${
                    testResult.ready ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                  }`}
                >
                  {testResult.summary}
                </div>
                <ul className="space-y-1 text-xs">
                  {testResult.checks.map((c) => (
                    <li key={c.name} className="flex gap-2">
                      <span
                        className={
                          c.status === "pass"
                            ? "text-green-600"
                            : c.status === "warn"
                              ? "text-amber-600"
                              : "text-red-600"
                        }
                      >
                        {c.status === "pass" ? "✓" : c.status === "warn" ? "!" : "✗"}
                      </span>
                      <span>
                        <span className="font-medium">{c.name}:</span> {c.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="card">
            <h3 className="mb-2 font-semibold">Activity</h3>
            <ul className="max-h-96 space-y-1.5 overflow-y-auto text-xs">
              {upload.events.map((e) => (
                <li key={e.id} className="border-b border-neutral-100 pb-1">
                  <span
                    className={`mr-1.5 inline-block w-12 font-mono ${
                      e.level === "error"
                        ? "text-red-600"
                        : e.level === "warn"
                          ? "text-amber-600"
                          : "text-neutral-500"
                    }`}
                  >
                    {e.level}
                  </span>
                  {e.message}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function LocalizationEditor({
  initial,
  onSave,
  busy,
}: {
  initial: Localization;
  onSave: (patch: Partial<Localization>) => void;
  busy: boolean;
}) {
  const t = useTranslations();
  const [data, setData] = useState<Localization>(initial);
  const dirty =
    data.title !== initial.title ||
    data.shortDescription !== initial.shortDescription ||
    data.description !== initial.description ||
    data.keywords !== initial.keywords ||
    data.whatsNew !== initial.whatsNew;

  return (
    <div className="space-y-3">
      <div>
        <label className="label">{t("review.fields.title")}</label>
        <input
          className="input"
          value={data.title}
          onChange={(e) => setData({ ...data, title: e.target.value })}
          maxLength={64}
        />
      </div>
      <div>
        <label className="label">{t("review.fields.shortDescription")}</label>
        <input
          className="input"
          value={data.shortDescription}
          onChange={(e) => setData({ ...data, shortDescription: e.target.value })}
          maxLength={80}
        />
      </div>
      <div>
        <label className="label">{t("review.fields.description")}</label>
        <textarea
          className="textarea h-48"
          value={data.description}
          onChange={(e) => setData({ ...data, description: e.target.value })}
          maxLength={8000}
        />
      </div>
      <div>
        <label className="label">{t("review.fields.keywords")}</label>
        <input
          className="input"
          value={data.keywords ?? ""}
          onChange={(e) => setData({ ...data, keywords: e.target.value })}
          maxLength={200}
        />
      </div>
      <div>
        <label className="label">{t("review.fields.whatsNew")}</label>
        <input
          className="input"
          value={data.whatsNew ?? ""}
          onChange={(e) => setData({ ...data, whatsNew: e.target.value })}
          maxLength={500}
        />
      </div>
      <button
        disabled={busy || !dirty}
        onClick={() =>
          onSave({
            title: data.title,
            shortDescription: data.shortDescription,
            description: data.description,
            keywords: data.keywords,
            whatsNew: data.whatsNew,
          })
        }
        className="btn btn-secondary disabled:opacity-50"
      >
        {t("common.save")}
      </button>
    </div>
  );
}

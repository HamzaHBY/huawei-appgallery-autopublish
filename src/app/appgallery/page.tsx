"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

interface Sdk {
  name: string;
  category: string;
  evidence: string;
}

interface FetchResult {
  id: string;
  sourceUrl: string;
  appStoreId: string | null;
  packageName: string | null;
  appName: string | null;
  versionName: string | null;
  versionCode: number | null;
  developer: string | null;
  iconUrl: string | null;
  description: string | null;
  apkPath: string | null;
  apkSize: string | null;
  minSdkVersion: number | null;
  targetSdkVersion: number | null;
  label: string | null;
  permissions: string[];
  nativeAbis: string[];
  fileCount: number | null;
  sdks: Sdk[] | null;
  status: string;
  errorMessage: string | null;
  downloadedByUserAt: string | null;
  apkDeletedAt: string | null;
}

function mb(size: string | null): string {
  if (!size) return "—";
  return `${(Number(size) / 1024 / 1024).toFixed(1)} MB`;
}

export default function AppGalleryPage() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<FetchResult[]>([]);

  async function load() {
    try {
      const res = await fetch("/api/appgallery");
      const data = (await res.json()) as { fetches: FetchResult[] };
      setResults(data.fetches ?? []);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/appgallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: input }),
      });
      const data = (await res.json()) as { fetches?: FetchResult[]; error?: string };
      if (!res.ok && data.error) {
        setError(data.error);
      } else {
        setInput("");
        await load();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/appgallery?id=${id}`, { method: "DELETE" });
    await load();
  }

  const idCount = input
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => /C\d{4,}/.test(t)).length;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-brand hover:underline">
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Download from AppGallery</h1>
        <p className="text-sm text-neutral-500">
          Paste one or more public AppGallery links or C-ids (e.g.{" "}
          <code>https://appgallery.huawei.com/app/C115313535</code>). Each APK is downloaded, the
          SDKs / permissions / size are analyzed, then you can download the binary. APKs you don&apos;t
          download are auto-deleted from the server after ~2 days to free space.
        </p>
      </div>

      <div className="card space-y-3">
        <textarea
          className="select min-h-[96px] font-mono text-xs"
          placeholder={"https://appgallery.huawei.com/app/C115313535\nC114925163\nhttps://appgallery.huawei.com/app/C100000000"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <button
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={busy || idCount === 0}
            onClick={submit}
          >
            {busy ? "Fetching & analyzing…" : `Fetch ${idCount || ""} app${idCount === 1 ? "" : "s"}`.trim()}
          </button>
          {idCount > 0 && !busy && (
            <span className="text-xs text-neutral-500">{idCount} valid C-id(s) detected</span>
          )}
          {busy && (
            <span className="text-xs text-neutral-500">
              Large game APKs can be hundreds of MB — this can take a few minutes.
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <div className="space-y-4">
        {results.map((r) => (
          <ResultCard key={r.id} r={r} onDelete={() => remove(r.id)} />
        ))}
        {results.length === 0 && !busy && (
          <p className="text-sm text-neutral-400">No apps fetched yet.</p>
        )}
      </div>
    </div>
  );
}

function ResultCard({ r, onDelete }: { r: FetchResult; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const statusColor =
    r.status === "DOWNLOADED"
      ? "bg-green-100 text-green-800"
      : r.status === "PENDING"
        ? "bg-blue-100 text-blue-800"
        : "bg-red-100 text-red-800";

  const sdksByCategory = (r.sdks ?? []).reduce<Record<string, Sdk[]>>((acc, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {});

  const canDownload = r.status === "DOWNLOADED" && r.apkPath && !r.apkDeletedAt;

  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {r.iconUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.iconUrl} alt="" className="h-12 w-12 rounded-xl" />
          )}
          <div>
            <h2 className="text-base font-semibold">
              {r.appName ?? r.label ?? r.packageName ?? r.appStoreId ?? "Unknown"}
            </h2>
            <div className="font-mono text-xs text-neutral-500">{r.packageName ?? r.appStoreId}</div>
          </div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs ${statusColor}`}>{r.status}</span>
      </div>

      {r.errorMessage && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {r.errorMessage}
        </div>
      )}

      {r.status === "DOWNLOADED" && (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
            <Info label="AppGallery ID" value={r.appStoreId ?? "—"} />
            <Info label="Version" value={r.versionName ? `${r.versionName}${r.versionCode ? ` (${r.versionCode})` : ""}` : "—"} />
            <Info label="APK size" value={mb(r.apkSize)} />
            <Info label="SDKs detected" value={String((r.sdks ?? []).length)} />
            <Info label="Min / Target SDK" value={`${r.minSdkVersion ?? "?"} / ${r.targetSdkVersion ?? "?"}`} />
            <Info label="ABIs" value={r.nativeAbis.length ? r.nativeAbis.join(", ") : "—"} />
            <Info label="Permissions" value={String(r.permissions.length)} />
            <Info label="Files in APK" value={r.fileCount != null ? String(r.fileCount) : "—"} />
          </dl>

          <div className="flex flex-wrap items-center gap-3">
            {canDownload ? (
              <a
                className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white"
                href={`/api/appgallery/${r.id}/download`}
              >
                Download APK ({mb(r.apkSize)})
              </a>
            ) : (
              <span className="text-xs text-amber-700">
                {r.apkDeletedAt ? "APK auto-deleted to free space — fetch again to re-download." : "APK not on disk."}
              </span>
            )}
            <button className="text-sm text-neutral-500 hover:underline" onClick={() => setOpen((o) => !o)}>
              {open ? "Hide full info" : "Show full info (SDKs, permissions)"}
            </button>
            <button className="ms-auto text-sm text-red-600 hover:underline" onClick={onDelete}>
              Delete from server
            </button>
          </div>

          {open && (
            <div className="space-y-4 border-t pt-3">
              <div>
                <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">
                  Detected SDKs ({(r.sdks ?? []).length})
                </div>
                {Object.keys(sdksByCategory).length === 0 ? (
                  <p className="text-sm text-neutral-500">No known SDK signatures matched.</p>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(sdksByCategory).map(([cat, list]) => (
                      <div key={cat}>
                        <div className="text-xs font-medium text-neutral-600">{cat}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {list.map((s) => (
                            <span
                              key={s.name}
                              title={s.evidence}
                              className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700"
                            >
                              {s.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">
                  Permissions ({r.permissions.length})
                </div>
                <div className="max-h-48 overflow-auto rounded bg-neutral-50 p-2 font-mono text-xs text-neutral-600">
                  {r.permissions.length === 0 ? "none" : r.permissions.map((p) => <div key={p}>{p}</div>)}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-neutral-400">{label}</dt>
      <dd className="font-medium break-words">{value}</dd>
    </div>
  );
}

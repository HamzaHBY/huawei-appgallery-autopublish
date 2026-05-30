"use client";
import { useState } from "react";
import Link from "next/link";

interface FetchResult {
  id: string;
  sourceUrl: string;
  appStoreId: string | null;
  packageName: string | null;
  appName: string | null;
  versionName: string | null;
  developer: string | null;
  iconUrl: string | null;
  description: string | null;
  apkPath: string | null;
  apkSize: string | null;
  status: string;
  errorMessage: string | null;
}

export default function AppGalleryPage() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FetchResult | null>(null);

  async function submit() {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const res = await fetch("/api/appgallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as FetchResult & { error?: string };
      if (!res.ok && data.error) {
        setError(data.error);
      } else {
        setResult(data);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const statusColor =
    result?.status === "DOWNLOADED"
      ? "bg-green-100 text-green-800"
      : result?.status === "INFO_ONLY"
        ? "bg-amber-100 text-amber-800"
        : "bg-red-100 text-red-800";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-brand hover:underline">
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Fetch from AppGallery</h1>
        <p className="text-sm text-neutral-500">
          Paste a public AppGallery link (e.g. <code>https://appgallery.huawei.com/app/C115313535</code>) to
          fetch the app info and download the published APK when Huawei exposes it.
        </p>
      </div>

      <div className="card space-y-3">
        <input
          className="select"
          placeholder="https://appgallery.huawei.com/app/C115313535"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && url.trim() && !busy && submit()}
        />
        <button
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={busy || !url.trim()}
          onClick={submit}
        >
          {busy ? "Fetching…" : "Fetch app"}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      {result && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{result.appName ?? result.appStoreId ?? "Result"}</h2>
            <span className={`rounded-full px-2 py-0.5 text-xs ${statusColor}`}>{result.status}</span>
          </div>
          {result.iconUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={result.iconUrl} alt="icon" className="h-16 w-16 rounded-xl" />
          )}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Info label="AppGallery ID" value={result.appStoreId ?? "—"} />
            <Info label="Package" value={result.packageName ?? "—"} />
            <Info label="Version" value={result.versionName ?? "—"} />
            <Info label="Developer" value={result.developer ?? "—"} />
            <Info
              label="APK"
              value={
                result.apkPath
                  ? `Downloaded${result.apkSize ? ` (${(Number(result.apkSize) / 1024 / 1024).toFixed(1)} MB)` : ""}`
                  : "Not downloaded"
              }
            />
          </dl>
          {result.description && (
            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-400">Description</div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{result.description}</p>
            </div>
          )}
          {result.errorMessage && (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {result.errorMessage}
            </div>
          )}
        </div>
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

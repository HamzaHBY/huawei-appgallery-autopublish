"use client";
import { useRef, useState } from "react";
import Link from "next/link";

interface Sdk {
  name: string;
  category: string;
  evidence: string;
}
interface AnalyzeResult {
  id: string;
  apk: {
    packageName: string;
    versionName: string;
    versionCode: number;
    minSdkVersion: number;
    targetSdkVersion: number;
    label: string;
    permissions: string[];
    sha256: string;
  };
  sdks: Sdk[];
  fileCount: number;
  dexCount: number;
  nativeAbis: string[];
  totalUncompressed: number;
}

export default function AnalyzePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResult | null>(null);

  function handleFile(file: File) {
    setError(null);
    setResult(null);
    setBusy(true);
    setProgress(0);
    const form = new FormData();
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/analyze");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      setBusy(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        setResult(JSON.parse(xhr.responseText));
      } else {
        try {
          setError(JSON.parse(xhr.responseText).error ?? xhr.responseText);
        } catch {
          setError(xhr.responseText || "Analysis failed");
        }
      }
    };
    xhr.onerror = () => {
      setBusy(false);
      setError("Network error");
    };
    xhr.send(form);
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-brand hover:underline">
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-bold">APK SDK Analyzer</h1>
        <p className="text-sm text-neutral-500">
          Upload any APK to detect the third-party SDKs it bundles and see full app info.
        </p>
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        className="cursor-pointer rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 p-10 text-center transition-colors hover:border-brand hover:bg-neutral-100"
      >
        <input
          ref={inputRef}
          type="file"
          accept=".apk,application/vnd.android.package-archive"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <p className="text-neutral-600">
          Drop an <code>.apk</code> here or click to choose
        </p>
      </div>

      {busy && (
        <div>
          <div className="h-2 rounded-full bg-neutral-100">
            <div className="h-2 rounded-full bg-brand" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            {progress < 100 ? `Uploading… ${progress}%` : "Analyzing APK…"}
          </p>
        </div>
      )}

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      {result && (
        <div className="space-y-6">
          <div className="card">
            <h2 className="mb-3 text-lg font-semibold">{result.apk.label}</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <Info label="Package" value={result.apk.packageName} />
              <Info label="Version" value={`${result.apk.versionName} (${result.apk.versionCode})`} />
              <Info label="Min / Target SDK" value={`${result.apk.minSdkVersion} / ${result.apk.targetSdkVersion}`} />
              <Info label="Native ABIs" value={result.nativeAbis.join(", ") || "none"} />
              <Info label="Files / DEX" value={`${result.fileCount} / ${result.dexCount}`} />
              <Info label="Uncompressed" value={`${(result.totalUncompressed / 1024 / 1024).toFixed(1)} MB`} />
            </dl>
          </div>

          <div className="card">
            <h2 className="mb-3 text-lg font-semibold">
              Detected SDKs <span className="text-neutral-400">({result.sdks.length})</span>
            </h2>
            {result.sdks.length === 0 ? (
              <p className="text-sm text-neutral-500">No known SDK signatures matched.</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-neutral-200">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 text-left text-neutral-600">
                    <tr>
                      <th className="px-3 py-2">SDK</th>
                      <th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2">Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.sdks.map((s) => (
                      <tr key={s.name} className="border-t border-neutral-100">
                        <td className="px-3 py-2 font-medium">{s.name}</td>
                        <td className="px-3 py-2">{s.category}</td>
                        <td className="px-3 py-2 font-mono text-xs text-neutral-500">{s.evidence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <h2 className="mb-3 text-lg font-semibold">
              Permissions <span className="text-neutral-400">({result.apk.permissions.length})</span>
            </h2>
            <div className="flex flex-wrap gap-2">
              {result.apk.permissions.map((p) => (
                <span key={p} className="rounded bg-neutral-100 px-2 py-0.5 font-mono text-xs">
                  {p.replace("android.permission.", "")}
                </span>
              ))}
            </div>
          </div>
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

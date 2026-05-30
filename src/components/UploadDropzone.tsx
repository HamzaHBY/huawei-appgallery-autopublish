"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

interface AppOption {
  id: string;
  displayName: string;
  packageName: string;
}

export function UploadDropzone({ apps }: { apps: AppOption[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedAppId, setSelectedAppId] = useState(apps[0]?.id ?? "");
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (!selectedAppId) {
      setError("Pick a Huawei app first");
      return;
    }
    setError(null);
    setIsUploading(true);
    setProgress(0);

    const form = new FormData();
    form.append("file", file);
    form.append("huaweiAppId", selectedAppId);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      setIsUploading(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        const { id } = JSON.parse(xhr.responseText);
        router.push(`/uploads/${id}`);
      } else {
        setError(`Upload failed: ${xhr.responseText}`);
      }
    };
    xhr.onerror = () => {
      setIsUploading(false);
      setError("Network error");
    };
    xhr.send(form);
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="label">Target Huawei app</label>
        <select
          className="select"
          value={selectedAppId}
          onChange={(e) => setSelectedAppId(e.target.value)}
        >
          {apps.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName} ({a.packageName})
            </option>
          ))}
        </select>
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        className="cursor-pointer rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 p-12 text-center transition-colors hover:border-brand hover:bg-neutral-100"
      >
        <input
          ref={inputRef}
          type="file"
          accept=".apk,application/vnd.android.package-archive"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <p className="text-neutral-600">
          Drop your <code>.apk</code> here or click to choose
        </p>
        <p className="mt-1 text-xs text-neutral-400">Up to 500 MB</p>
      </div>

      {isUploading && (
        <div>
          <div className="h-2 rounded-full bg-neutral-100">
            <div className="h-2 rounded-full bg-brand" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-xs text-neutral-500">Uploading… {progress}%</p>
        </div>
      )}

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
    </div>
  );
}

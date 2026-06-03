"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

interface AppOption {
  id: string;
  displayName: string;
  packageName: string;
}

const SCREENSHOT_SOURCES: Array<{ value: string; label: string; hint: string }> = [
  { value: "vmos", label: "VMOS emulator (real device)", hint: "Installs the APK on a cloud Android device and captures real screens from different stages." },
  { value: "ai_openai", label: "AI · ChatGPT (OpenAI gpt-image)", hint: "Generates store screenshots with OpenAI's gpt-image models (choose gpt-image-1 / gpt-image-2 in Settings). Prompts auto-built from the APK." },
  { value: "ai_gemini", label: "AI · nano banana (Gemini 2.5 Flash Image)", hint: "Generates store screenshots with Google's nano banana model." },
  { value: "template", label: "Template (icon + tagline)", hint: "Fast deterministic mockups using the app icon and generated taglines." },
];

export function UploadDropzone({ apps }: { apps: AppOption[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  // "" = auto-detect from APK (APK-only flow)
  const [selectedAppId, setSelectedAppId] = useState("");
  const [screenshotSource, setScreenshotSource] = useState("vmos");
  const [metadataPrompt, setMetadataPrompt] = useState("");
  const [screenshotPrompt, setScreenshotPrompt] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setIsUploading(true);
    setProgress(0);

    const form = new FormData();
    form.append("file", file);
    if (selectedAppId) form.append("huaweiAppId", selectedAppId);
    form.append("screenshotSource", screenshotSource);
    if (metadataPrompt.trim()) form.append("metadataPrompt", metadataPrompt.trim());
    if (screenshotPrompt.trim()) form.append("screenshotPrompt", screenshotPrompt.trim());

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

  const activeHint = SCREENSHOT_SOURCES.find((s) => s.value === screenshotSource)?.hint;
  const isAi = screenshotSource === "ai_openai" || screenshotSource === "ai_gemini";

  return (
    <div className="space-y-4">
      <div>
        <label className="label">Target Huawei app</label>
        <select
          className="select"
          value={selectedAppId}
          onChange={(e) => setSelectedAppId(e.target.value)}
        >
          <option value="">Auto-detect from APK (recommended)</option>
          {apps.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName} ({a.packageName})
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-neutral-500">
          Auto-detect extracts the name + package ID from the APK and links the matching AppGallery
          app automatically.
        </p>
      </div>

      <div>
        <label className="label">Screenshots</label>
        <select
          className="select"
          value={screenshotSource}
          onChange={(e) => setScreenshotSource(e.target.value)}
        >
          {SCREENSHOT_SOURCES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {activeHint && <p className="mt-1 text-xs text-neutral-500">{activeHint}</p>}
      </div>

      {isAi && (
        <div>
          <label className="label">Screenshot prompt (optional)</label>
          <textarea
            className="select min-h-[72px]"
            placeholder="e.g. 5 screenshots: title screen, choosing a dress, makeup studio, hair salon, final runway reveal with confetti."
            value={screenshotPrompt}
            onChange={(e) => setScreenshotPrompt(e.target.value)}
          />
          <p className="mt-1 text-xs text-neutral-500">
            Describe the concept or stages you want. The 4–5 AI screenshots are generated to match
            your description. Leave blank to auto-derive scenes from the APK.
          </p>
        </div>
      )}

      <div>
        <label className="label">Metadata prompt (optional)</label>
        <textarea
          className="select min-h-[72px]"
          placeholder="e.g. Emphasize that it's a relaxing dress-up game for kids; friendly, playful tone."
          value={metadataPrompt}
          onChange={(e) => setMetadataPrompt(e.target.value)}
        />
        <p className="mt-1 text-xs text-neutral-500">
          Steers the AI-written title/description. Leave blank to auto-generate from the APK.
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

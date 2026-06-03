"use client";
import { useEffect, useState } from "react";

type TextProvider = "openai" | "deepseek" | "gemini";
type ImageProvider = "openai" | "gemini";

interface KeyState {
  fromDb: boolean;
  fromEnv: boolean;
}

interface SettingsView {
  textProvider: TextProvider;
  textModel: string;
  imageProvider: ImageProvider;
  imageModel: string;
  textModels: Record<TextProvider, string[]>;
  imageModels: Record<ImageProvider, string[]>;
  providerLabels: Record<string, string>;
  keyState: Record<TextProvider, KeyState>;
}

const KEY_PLACEHOLDER = {
  openai: "sk-...",
  deepseek: "sk-...",
  gemini: "AIza...",
} as const;

export function AiSettingsForm() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [textProvider, setTextProvider] = useState<TextProvider>("openai");
  const [textModel, setTextModel] = useState("");
  const [imageProvider, setImageProvider] = useState<ImageProvider>("openai");
  const [imageModel, setImageModel] = useState("");
  const [keys, setKeys] = useState<Record<TextProvider, string>>({
    openai: "",
    deepseek: "",
    gemini: "",
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function apply(v: SettingsView) {
    setView(v);
    setTextProvider(v.textProvider);
    setTextModel(v.textModel);
    setImageProvider(v.imageProvider);
    setImageModel(v.imageModel);
  }

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(apply)
      .catch(() => setError("Failed to load settings"));
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    setStatus(null);
    const keyPayload: Partial<Record<TextProvider, string>> = {};
    for (const p of ["openai", "deepseek", "gemini"] as TextProvider[]) {
      if (keys[p].trim().length > 0) keyPayload[p] = keys[p].trim();
    }
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        textProvider,
        textModel,
        imageProvider,
        imageModel,
        keys: keyPayload,
      }),
    });
    setBusy(false);
    if (res.ok) {
      const v = (await res.json()) as SettingsView;
      apply(v);
      setKeys({ openai: "", deepseek: "", gemini: "" });
      setStatus("Saved.");
    } else {
      setError(await res.text());
    }
  }

  async function clearKey(provider: TextProvider) {
    setBusy(true);
    setError(null);
    setStatus(null);
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: { [provider]: "__CLEAR__" } }),
    });
    setBusy(false);
    if (res.ok) {
      apply((await res.json()) as SettingsView);
      setStatus(`Cleared ${provider} key.`);
    } else {
      setError(await res.text());
    }
  }

  if (!view) {
    return <p className="text-sm text-neutral-500">Loading AI settings…</p>;
  }

  const textModelOptions = view.textModels[textProvider] ?? [];
  const imageModelOptions = view.imageModels[imageProvider] ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Text model provider (metadata + prompts)</label>
          <select
            className="select"
            value={textProvider}
            onChange={(e) => {
              const p = e.target.value as TextProvider;
              setTextProvider(p);
              setTextModel(view.textModels[p][0]);
            }}
          >
            {(Object.keys(view.textModels) as TextProvider[]).map((p) => (
              <option key={p} value={p}>
                {view.providerLabels[p] ?? p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Text model</label>
          <select className="select" value={textModel} onChange={(e) => setTextModel(e.target.value)}>
            {textModelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Image model provider (screenshots)</label>
          <select
            className="select"
            value={imageProvider}
            onChange={(e) => {
              const p = e.target.value as ImageProvider;
              setImageProvider(p);
              setImageModel(view.imageModels[p][0]);
            }}
          >
            {(Object.keys(view.imageModels) as ImageProvider[]).map((p) => (
              <option key={p} value={p}>
                {view.providerLabels[p] ?? p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Image model</label>
          <select className="select" value={imageModel} onChange={(e) => setImageModel(e.target.value)}>
            {imageModelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">API keys</h3>
        <div className="space-y-3">
          {(["openai", "deepseek", "gemini"] as TextProvider[]).map((p) => {
            const st = view.keyState[p];
            const configured = st.fromDb || st.fromEnv;
            return (
              <div key={p} className="flex flex-wrap items-center gap-2">
                <div className="w-28 text-sm">{view.providerLabels[p] ?? p}</div>
                <input
                  className="input flex-1 min-w-[200px]"
                  type="password"
                  placeholder={
                    configured
                      ? st.fromDb
                        ? "•••••••• (saved — type to replace)"
                        : "set via env var (type to override)"
                      : KEY_PLACEHOLDER[p]
                  }
                  value={keys[p]}
                  onChange={(e) => setKeys({ ...keys, [p]: e.target.value })}
                />
                <span
                  className={`text-xs ${configured ? "text-green-600" : "text-neutral-400"}`}
                >
                  {st.fromDb ? "saved" : st.fromEnv ? "env" : "not set"}
                </span>
                {st.fromDb && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => clearKey(p)}
                    className="btn btn-secondary text-xs disabled:opacity-50"
                  >
                    Clear
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Keys saved here are stored in the database and take precedence over environment variables.
          DeepSeek and Gemini are reached via their OpenAI-compatible endpoints.
        </p>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
      {status && <p className="text-sm text-green-600">{status}</p>}

      <button disabled={busy} onClick={save} className="btn btn-primary disabled:opacity-50">
        {busy ? "Saving…" : "Save AI settings"}
      </button>
    </div>
  );
}

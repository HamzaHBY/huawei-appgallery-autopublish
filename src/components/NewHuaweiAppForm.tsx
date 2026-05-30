"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function NewHuaweiAppForm({
  categories,
}: {
  categories: Array<{ id: number; label: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    agcAppId: "",
    packageName: "",
    displayName: "",
    category: 2,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/huawei-apps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (res.ok) {
      router.refresh();
      setForm({ agcAppId: "", packageName: "", displayName: "", category: 2 });
    } else {
      setError(await res.text());
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className="label">AGC App ID</label>
        <input
          className="input"
          required
          value={form.agcAppId}
          onChange={(e) => setForm({ ...form, agcAppId: e.target.value })}
        />
      </div>
      <div>
        <label className="label">Package name</label>
        <input
          className="input"
          required
          value={form.packageName}
          onChange={(e) => setForm({ ...form, packageName: e.target.value })}
        />
      </div>
      <div>
        <label className="label">Display name</label>
        <input
          className="input"
          required
          value={form.displayName}
          onChange={(e) => setForm({ ...form, displayName: e.target.value })}
        />
      </div>
      <div>
        <label className="label">Default category</label>
        <select
          className="select"
          value={form.category}
          onChange={(e) => setForm({ ...form, category: parseInt(e.target.value, 10) })}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <div className="sm:col-span-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
      <div className="sm:col-span-2">
        <button disabled={busy} className="btn btn-primary disabled:opacity-50">
          Save app
        </button>
      </div>
    </form>
  );
}

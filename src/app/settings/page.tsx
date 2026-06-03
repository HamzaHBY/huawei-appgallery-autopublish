import { prisma } from "@/lib/db";
import { NewHuaweiAppForm } from "@/components/NewHuaweiAppForm";
import { AiSettingsForm } from "@/components/AiSettingsForm";

export const dynamic = "force-dynamic";

const CATEGORIES = [
  { id: 2, label: "Apps · Tools" },
  { id: 3, label: "Apps · Productivity" },
  { id: 4, label: "Apps · Communication" },
  { id: 6, label: "Apps · Social" },
  { id: 7, label: "Apps · Lifestyle" },
  { id: 8, label: "Apps · Entertainment" },
  { id: 14, label: "Games · Casual" },
  { id: 15, label: "Games · Arcade" },
  { id: 16, label: "Games · Puzzle" },
  { id: 17, label: "Games · Action" },
];

export default async function SettingsPage() {
  const apps = await prisma.huaweiApp.findMany({ orderBy: { createdAt: "desc" } });

  const hasCreds =
    !!process.env.HUAWEI_AGC_CLIENT_ID && !!process.env.HUAWEI_AGC_CLIENT_SECRET;
  const hasOpenai = !!process.env.OPENAI_API_KEY;
  const hasAppetize = !!process.env.APPETIZE_API_TOKEN;

  return (
    <div className="space-y-8">
      <section className="card">
        <h2 className="mb-1 text-lg font-semibold">AI models</h2>
        <p className="mb-4 text-sm text-neutral-500">
          Choose which provider/model generates your text (metadata) and images (screenshots), and
          manage API keys for OpenAI, DeepSeek, and Gemini.
        </p>
        <AiSettingsForm />
      </section>

      <section className="card">
        <h2 className="mb-4 text-lg font-semibold">API credentials</h2>
        <ul className="space-y-2 text-sm">
          <CredRow ok={hasCreds} label="Huawei AppGallery Connect API (CLIENT_ID + SECRET)" />
          <CredRow ok={hasOpenai} label="OpenAI API key (metadata + translation)" />
          <CredRow ok={hasAppetize} label="Appetize.io token (optional, real screenshots)" />
        </ul>
        <p className="mt-3 text-xs text-neutral-500">
          Credentials are loaded from environment variables at runtime — see <code>.env.example</code>.
        </p>
      </section>

      <section className="card">
        <h2 className="mb-4 text-lg font-semibold">Huawei apps ({apps.length})</h2>
        {apps.length === 0 ? (
          <p className="mb-4 text-sm text-neutral-500">
            You haven&apos;t registered any Huawei apps yet. Create one in the Huawei console first, then add it here.
          </p>
        ) : (
          <table className="mb-4 w-full text-sm">
            <thead className="text-left text-neutral-600">
              <tr>
                <th className="py-2">App</th>
                <th className="py-2">Package</th>
                <th className="py-2">AGC App ID</th>
                <th className="py-2">Category</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="py-2">{a.displayName}</td>
                  <td className="py-2 font-mono text-xs">{a.packageName}</td>
                  <td className="py-2 font-mono text-xs">{a.agcAppId}</td>
                  <td className="py-2">{CATEGORIES.find((c) => c.id === a.category)?.label ?? a.category}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h3 className="mb-2 text-sm font-medium">Add new app</h3>
        <NewHuaweiAppForm categories={CATEGORIES} />
      </section>
    </div>
  );
}

function CredRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? "bg-green-500" : "bg-neutral-300"}`}
      />
      <span>{label}</span>
      <span className={`ms-auto text-xs ${ok ? "text-green-600" : "text-neutral-400"}`}>
        {ok ? "configured" : "not set"}
      </span>
    </li>
  );
}

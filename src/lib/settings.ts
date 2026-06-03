// DB-backed key/value settings with environment-variable fallback.
//
// Settings (including AI provider API keys) are stored in the `Setting` table so
// they can be managed from the UI. Environment variables remain the fallback so
// existing Fly secrets keep working without any DB rows.
import { prisma } from "./db";

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function getSettings(keys: string[]): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany({ where: { key: { in: keys } } });
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export async function deleteSetting(key: string): Promise<void> {
  await prisma.setting.deleteMany({ where: { key } });
}

// Resolve a value from DB first, then fall back to an environment variable.
export async function getSettingOrEnv(key: string, envVar: string): Promise<string | null> {
  const fromDb = await getSetting(key);
  if (fromDb && fromDb.trim().length > 0) return fromDb;
  const fromEnv = process.env[envVar];
  return fromEnv && fromEnv.trim().length > 0 ? fromEnv : null;
}

// Generates AppGallery metadata (title, short description, full description,
// keywords, what's new) from parsed APK info using GPT-4o.
import { z } from "zod";
import { getTextClient } from "./ai-config";
import type { ParsedApk } from "./apk-parser";

export const GeneratedMetadataSchema = z.object({
  title: z.string().min(2).max(64),
  shortDescription: z.string().min(10).max(80),
  description: z.string().min(50).max(8000),
  keywords: z.string().max(200),
  whatsNew: z.string().max(500),
});

export type GeneratedMetadata = z.infer<typeof GeneratedMetadataSchema>;

const SYSTEM_PROMPT = `You are a senior ASO (App Store Optimization) writer for Huawei AppGallery. You write compelling, policy-compliant app listings that comply with Huawei's editorial policy:
- No claims of being "#1", "best", or unverifiable rankings.
- No mentions of Google Play, Apple App Store, or competitors.
- No misleading or sensational language.
- Title: under 64 characters, brand-first, no emojis.
- Short description: a punchy one-liner under 80 characters.
- Full description: 3-6 short paragraphs, marketing-y but factual; end with a feature bullet list.
- Keywords: comma-separated, lowercase, no duplicates, no punctuation; under 200 chars.
- What's new: 1-3 short lines, plain text.
Output ONLY valid JSON matching the schema, no markdown code fences.`;

export async function generateMetadata(
  apk: ParsedApk,
  locale = "en-US",
  customPrompt?: string | null,
): Promise<GeneratedMetadata> {
  const { client: openai, model } = await getTextClient();

  const steer = customPrompt && customPrompt.trim().length > 0
    ? `\n\nIMPORTANT — follow these user instructions for tone/positioning/content (without violating Huawei policy or the character limits):\n"""${customPrompt.trim()}"""`
    : "";

  const userPrompt = `Generate Huawei AppGallery store listing metadata in language "${locale}" for this app.

Parsed APK info:
- Package: ${apk.packageName}
- App label: ${apk.label}
- Version: ${apk.versionName} (code ${apk.versionCode})
- Min Android API: ${apk.minSdkVersion}
- Target Android API: ${apk.targetSdkVersion}
- Permissions (top 10): ${apk.permissions.slice(0, 10).join(", ") || "none"}

Infer the app's purpose and target audience from the package name, label, and permissions. If it appears to be a game, write game-style copy; otherwise utility/productivity copy.${steer}

Return JSON with fields: title, shortDescription, description, keywords, whatsNew.`;

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw);
  return GeneratedMetadataSchema.parse(parsed);
}

export async function translateMetadata(
  source: GeneratedMetadata,
  fromLocale: string,
  toLocale: string,
): Promise<GeneratedMetadata> {
  if (fromLocale === toLocale) return source;
  const { client: openai, model } = await getTextClient();

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `You translate Huawei AppGallery listings while preserving marketing tone, character limits, and Huawei policy compliance. Keep proper nouns (brand name, app name) untranslated. Output JSON only with the same field names.`,
      },
      {
        role: "user",
        content: `Translate this listing from ${fromLocale} to ${toLocale}. Respect character limits: title<=64, shortDescription<=80, description<=8000, keywords<=200, whatsNew<=500.

${JSON.stringify(source, null, 2)}`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw);
  return GeneratedMetadataSchema.parse(parsed);
}

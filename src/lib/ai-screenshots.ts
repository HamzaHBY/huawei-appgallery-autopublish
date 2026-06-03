// AI-generated app screenshots.
//
// Two providers, both producing 1080x1920 phone screenshots for Huawei AppGallery:
//   - "ai_openai" → OpenAI gpt-image-1 (uses OPENAI_API_KEY)
//   - "ai_gemini" → Google "nano banana" gemini-2.5-flash-image (uses GEMINI_API_KEY)
//
// Prompts are generated automatically from the parsed APK (label, package,
// permissions, generated taglines) by GPT-4o, with a deterministic fallback so
// this still works if the prompt-LLM call fails.
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import OpenAI from "openai";
import { getApiKey, getTextClient, resolveImageModel } from "./ai-config";
import type { ParsedApk } from "./apk-parser";
import type { GeneratedScreenshot } from "./screenshots";

const W = 1080;
const H = 1920;

export type AiProvider = "ai_openai" | "ai_gemini";

export function aiImageModelLabel(provider: AiProvider): string {
  return provider === "ai_gemini" ? "gemini-2.5-flash-image (nano banana)" : "OpenAI gpt-image";
}

// ---------------------- Prompt generation ----------------------

const STYLE_SUFFIX =
  "Vertical 9:16 mobile phone screenshot mockup, clean modern UI, vibrant colors, " +
  "high detail, app store marketing quality, no text watermarks, no device frame bezel.";

// Ask GPT for N concrete scene prompts describing distinct screens/stages of the app.
// When `customPrompt` is provided, the user's concept/stages drive the scenes.
export async function buildScreenshotPrompts(
  apk: ParsedApk,
  count: number,
  taglines: string[],
  customPrompt?: string | null,
): Promise<string[]> {
  const hasCustom = !!(customPrompt && customPrompt.trim().length > 0);
  const fallback = (): string[] => {
    const base = apk.label || apk.packageName || "the app";
    const seeds = [
      `Home screen of "${base}"`,
      `Main feature in action in "${base}"`,
      `Settings / customization screen of "${base}"`,
      `A rewarding moment / results screen in "${base}"`,
      `Onboarding / welcome screen of "${base}"`,
      `Detailed content view in "${base}"`,
    ];
    const concept = hasCustom ? ` Concept: ${customPrompt!.trim()}.` : "";
    return seeds.slice(0, count).map((s, i) => `${s}.${concept} ${taglines[i] ? `Theme: ${taglines[i]}. ` : ""}${STYLE_SUFFIX}`);
  };

  const steer = hasCustom
    ? `\n\nThe user described what the screenshots should represent. Treat this as the PRIMARY brief — derive ${count} distinct scenes that realize the concept/stages described, in order:\n"""${customPrompt!.trim()}"""`
    : "";

  try {
    const { client: openai, model } = await getTextClient();
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You write image-generation prompts for app store screenshots. Given an app's info, " +
            "produce distinct prompts each depicting a DIFFERENT screen or stage of the app " +
            "(e.g. home, core gameplay/feature, progress, settings, results). Output JSON only: " +
            '{"prompts": ["...", "..."]}. Each prompt must be self-contained and visually concrete.',
        },
        {
          role: "user",
          content: `App label: ${apk.label}
Package: ${apk.packageName}
Permissions (hint at capabilities): ${apk.permissions.slice(0, 12).join(", ") || "none"}
Taglines: ${taglines.join(" | ")}${steer}

Generate exactly ${count} prompts, each ending with this exact style instruction: "${STYLE_SUFFIX}"`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.8,
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { prompts?: unknown };
    const prompts = Array.isArray(parsed.prompts)
      ? parsed.prompts.filter((p): p is string => typeof p === "string" && p.length > 0)
      : [];
    if (prompts.length >= 1) return prompts.slice(0, count);
    return fallback();
  } catch {
    return fallback();
  }
}

// ---------------------- Providers ----------------------

async function generateWithOpenAI(prompt: string): Promise<Buffer> {
  const apiKey = await getApiKey("openai");
  if (!apiKey) throw new Error("No OpenAI API key configured (Settings or OPENAI_API_KEY)");
  const model = await resolveImageModel("openai");
  const openai = new OpenAI({ apiKey });
  // dall-e-3 uses a different portrait size; gpt-image-* accept 1024x1536.
  const size = model === "dall-e-3" ? "1024x1792" : "1024x1536";
  const res = await openai.images.generate({ model, prompt, size: size as "1024x1536", n: 1 });
  const b64 = res.data?.[0]?.b64_json;
  if (b64) return Buffer.from(b64, "base64");
  // dall-e-3 returns a URL instead of b64 unless response_format is set.
  const remoteUrl = res.data?.[0]?.url;
  if (remoteUrl) {
    const r = await fetch(remoteUrl);
    return Buffer.from(await r.arrayBuffer());
  }
  throw new Error(`${model} returned no image data`);
}

async function generateWithGemini(prompt: string): Promise<Buffer> {
  const key = await getApiKey("gemini");
  if (!key) throw new Error("No Gemini API key configured (Settings or GEMINI_API_KEY)");
  const model = await resolveImageModel("gemini");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini image generation failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { data?: string }; inline_data?: { data?: string } }> };
    }>;
  };
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    const data = p.inlineData?.data ?? p.inline_data?.data;
    if (data) return Buffer.from(data, "base64");
  }
  throw new Error("Gemini returned no inline image data");
}

async function generateOne(provider: AiProvider, prompt: string): Promise<Buffer> {
  return provider === "ai_gemini" ? generateWithGemini(prompt) : generateWithOpenAI(prompt);
}

// ---------------------- Entry point ----------------------

export interface AiScreenshotsOpts {
  provider: AiProvider;
  count?: number;
  customPrompt?: string | null;
  onProgress?: (msg: string) => Promise<void> | void;
}

export async function generateAiScreenshots(
  apk: ParsedApk,
  outDir: string,
  taglines: string[],
  opts: AiScreenshotsOpts,
): Promise<GeneratedScreenshot[]> {
  await fs.mkdir(outDir, { recursive: true });
  const count = opts.count ?? 5;
  const prompts = await buildScreenshotPrompts(apk, count, taglines, opts.customPrompt);
  const results: GeneratedScreenshot[] = [];

  for (let i = 0; i < prompts.length; i++) {
    try {
      if (opts.onProgress) await opts.onProgress(`Generating AI screenshot ${i + 1}/${prompts.length}`);
      const raw = await generateOne(opts.provider, prompts[i]);
      const outPath = path.join(outDir, `ai-${i + 1}.png`);
      const normalized = await sharp(raw).resize(W, H, { fit: "cover", position: "centre" }).png().toBuffer();
      await fs.writeFile(outPath, normalized);
      results.push({ path: outPath, width: W, height: H, source: "ai" });
    } catch (err) {
      // Skip the failed frame but keep going; the caller decides on fallback.
      if (opts.onProgress) await opts.onProgress(`AI screenshot ${i + 1} failed: ${(err as Error).message}`);
    }
  }
  return results;
}

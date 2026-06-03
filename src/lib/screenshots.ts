// Screenshot generation pipeline with multiple strategies:
//   1. "emulator" — install the APK on the user's VMOS Cloud pad and capture
//                    preview frames (if VMOSCLOUD_* + VMOSCLOUD_PAD_CODE are set)
//   2. "emulator" — fall back to Appetize.io if VMOS is unavailable but
//                    APPETIZE_API_TOKEN is set
//   3. "template" — composite the app icon + label onto pre-rendered device
//                    frames (always-available fallback)
//
// All strategies produce PNGs sized for Huawei AppGallery phone screenshots
// (1080x1920).
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import type { ParsedApk } from "./apk-parser";
import { runAppetizeScreenshots } from "./appetize";
import { runVmosCloudScreenshots } from "./vmoscloud-screenshots";

export type ScreenshotSource = "emulator" | "template" | "ai";

export interface GeneratedScreenshot {
  path: string;
  width: number;
  height: number;
  source: ScreenshotSource;
}

const W = 1080;
const H = 1920;

// Generate 4-6 template screenshots: icon + label + tagline on gradient background.
async function generateTemplateScreenshots(
  apk: ParsedApk,
  outDir: string,
  taglines: string[],
): Promise<GeneratedScreenshot[]> {
  await fs.mkdir(outDir, { recursive: true });
  const palette = [
    ["#c8102e", "#7a0a1e"],
    ["#0e2a47", "#1d4d80"],
    ["#1b5e20", "#4caf50"],
    ["#4527a0", "#7e57c2"],
    ["#e65100", "#ffb74d"],
    ["#006064", "#26c6da"],
  ];
  const results: GeneratedScreenshot[] = [];

  const iconBuf = apk.iconPngPath ? await fs.readFile(apk.iconPngPath) : null;
  const iconResized = iconBuf
    ? await sharp(iconBuf).resize(360, 360, { fit: "contain" }).png().toBuffer()
    : null;

  const n = Math.min(taglines.length, palette.length);
  for (let i = 0; i < n; i++) {
    const [from, to] = palette[i];
    const tagline = (taglines[i] ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const safeLabel = apk.label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <text x="50%" y="1300" font-family="Arial, sans-serif" font-size="76" font-weight="700"
        fill="#ffffff" text-anchor="middle">${safeLabel}</text>
  <foreignObject x="80" y="1400" width="${W - 160}" height="400">
    <div xmlns="http://www.w3.org/1999/xhtml" style="
      color:#ffffff;
      font-family: Arial, sans-serif;
      font-size: 44px;
      line-height: 1.3;
      text-align: center;
      text-shadow: 0 1px 3px rgba(0,0,0,0.5);
    ">${tagline}</div>
  </foreignObject>
  <text x="50%" y="${H - 60}" font-family="Arial, sans-serif" font-size="28"
        fill="#ffffffaa" text-anchor="middle">${i + 1} / ${n}</text>
</svg>`;

    const bg = sharp(Buffer.from(svg));
    let composed = bg;
    if (iconResized) {
      composed = composed.composite([
        {
          input: iconResized,
          top: 880,
          left: Math.floor((W - 360) / 2),
        },
      ]);
    }
    const out = path.join(outDir, `screenshot-${i + 1}.png`);
    await composed.png().toFile(out);
    results.push({ path: out, width: W, height: H, source: "template" });
  }
  return results;
}

// What the user chose at upload time.
//   "vmos"      → real emulator capture (VMOS) with template fallback
//   "ai_openai" → OpenAI gpt-image-1
//   "ai_gemini" → Google nano banana (gemini-2.5-flash-image)
//   "template"  → deterministic icon/label composite
export type ScreenshotSourceChoice = "vmos" | "ai_openai" | "ai_gemini" | "template";

export interface GenerateScreenshotsOpts {
  uploadId: string;
  packageName?: string;
  source?: ScreenshotSourceChoice;
  customPrompt?: string | null;
  onProgress?: (msg: string) => Promise<void> | void;
}

export async function generateScreenshots(
  apk: ParsedApk,
  apkLocalPath: string,
  outDir: string,
  taglines: string[],
  opts?: GenerateScreenshotsOpts,
): Promise<GeneratedScreenshot[]> {
  const source = opts?.source ?? "vmos";

  // ---- AI providers ----
  if (source === "ai_openai" || source === "ai_gemini") {
    const { generateAiScreenshots } = await import("./ai-screenshots");
    try {
      const shots = await generateAiScreenshots(apk, outDir, taglines, {
        provider: source,
        customPrompt: opts?.customPrompt,
        onProgress: opts?.onProgress,
      });
      if (shots.length > 0) return shots;
      if (opts?.onProgress) await opts.onProgress("AI generation produced no images; using templates");
    } catch (err) {
      console.warn("AI screenshot generation failed, falling back to templates:", err);
    }
    return generateTemplateScreenshots(apk, outDir, taglines);
  }

  // ---- Explicit template choice ----
  if (source === "template") {
    return generateTemplateScreenshots(apk, outDir, taglines);
  }

  // ---- VMOS emulator (default) with Appetize → template fallback ----
  const hasVmos =
    !!process.env.VMOSCLOUD_ACCESS_KEY_ID &&
    !!process.env.VMOSCLOUD_SECRET_ACCESS_KEY &&
    !!process.env.VMOSCLOUD_PAD_CODE;
  const pkg = opts?.packageName ?? apk.packageName;
  if (hasVmos && opts?.uploadId && pkg) {
    try {
      const shots = await runVmosCloudScreenshots({
        uploadId: opts.uploadId,
        packageName: pkg,
        outDir,
      });
      if (shots.length > 0) return shots;
    } catch (err) {
      console.warn("VMOS Cloud screenshot capture failed, trying next strategy:", err);
    }
  }
  const hasAppetize = !!process.env.APPETIZE_API_TOKEN;
  if (hasAppetize) {
    try {
      const shots = await runAppetizeScreenshots(apkLocalPath, outDir);
      if (shots.length > 0) return shots;
    } catch (err) {
      console.warn("Appetize screenshot capture failed, falling back to templates:", err);
    }
  }
  return generateTemplateScreenshots(apk, outDir, taglines);
}

// Appetize.io API integration for real-device APK screenshots.
//
// Flow:
//   1. POST /v1/apps with form-data { file, platform: "android" } → app publicKey
//   2. Open a session via the WebSocket / runtime API, drive frames, capture
//      PNGs. Appetize exposes "screenshot" actions over its `client.js`/REST API.
//
// NOTE: Appetize's REST capture API requires opening a session per app. We use
// the `/v1/apps/<publicKey>/sessions` endpoint where supported. For accounts
// without that feature, we surface a clear error so the caller falls back to
// template screenshots.
import { promises as fs } from "fs";
import path from "path";
import type { GeneratedScreenshot } from "./screenshots";

const APPETIZE_BASE = "https://api.appetize.io";

interface AppetizeUploadResponse {
  publicKey: string;
}

interface AppetizeScreenshotResponse {
  data?: { base64?: string };
  base64?: string;
}

export async function runAppetizeScreenshots(
  apkPath: string,
  outDir: string,
): Promise<GeneratedScreenshot[]> {
  const token = process.env.APPETIZE_API_TOKEN;
  if (!token) throw new Error("APPETIZE_API_TOKEN not set");

  await fs.mkdir(outDir, { recursive: true });
  const apkBuf = await fs.readFile(apkPath);

  // 1. Upload APK
  const form = new FormData();
  form.append("file", new Blob([apkBuf]), path.basename(apkPath));
  form.append("platform", "android");

  const uploadRes = await fetch(`${APPETIZE_BASE}/v1/apps`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}`,
    },
    body: form,
  });
  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(`Appetize upload failed: ${uploadRes.status} ${text}`);
  }
  const uploaded = (await uploadRes.json()) as AppetizeUploadResponse;
  if (!uploaded.publicKey) throw new Error("Appetize upload missing publicKey");

  // 2. Capture screenshots. Appetize doesn't have a one-shot batch screenshot
  // endpoint, so we poll its session screenshot endpoint multiple times with
  // small delays to capture different app states. For accounts without this
  // endpoint, the call will 404 — we propagate to fall back to templates.
  const results: GeneratedScreenshot[] = [];
  for (let i = 0; i < 4; i++) {
    const res = await fetch(
      `${APPETIZE_BASE}/v1/apps/${uploaded.publicKey}/screenshot`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ device: "pixel7", osVersion: "13.0", delayMs: 2000 + i * 1500 }),
      },
    );
    if (!res.ok) {
      throw new Error(`Appetize screenshot ${i} failed: ${res.status}`);
    }
    const json = (await res.json()) as AppetizeScreenshotResponse;
    const b64 = json.base64 ?? json.data?.base64;
    if (!b64) throw new Error(`Appetize screenshot ${i} missing base64`);
    const outPath = path.join(outDir, `emulator-${i + 1}.png`);
    await fs.writeFile(outPath, Buffer.from(b64, "base64"));
    results.push({ path: outPath, width: 1080, height: 1920, source: "emulator" });
  }
  return results;
}

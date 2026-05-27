// VMOS Cloud screenshot orchestration:
//   1. Install the APK on the user's pre-provisioned VMOS pad (padCode from env)
//   2. Launch the main activity
//   3. Capture N preview frames (with small delays so the app reaches new screens)
//   4. Stop + uninstall the APK so we leave the device clean
//
// The APK must be reachable from VMOS Cloud's network. We expose it from this
// app at /api/uploads/[id]/apk and pass the public URL through APP_PUBLIC_URL
// (or NEXT_PUBLIC_APP_URL).
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { vmosClientFromEnv, VmosCloudClient, VmosCloudError } from "./vmoscloud";
import type { GeneratedScreenshot } from "./screenshots";

const W = 1080;
const H = 1920;

function getPublicAppUrl(): string | null {
  return (
    process.env.APP_PUBLIC_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    null
  );
}

function getPadCode(): string | null {
  return process.env.VMOSCLOUD_PAD_CODE ?? null;
}

async function fetchAndNormalize(url: string, outPath: string): Promise<GeneratedScreenshot | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  // VMOS preview URL may be a still PNG/JPEG. If it's a video stream we can't
  // decode it here — Sharp will throw and we'll fall back to template mockups.
  try {
    const resized = await sharp(buf)
      .resize(W, H, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();
    await fs.writeFile(outPath, resized);
    return { path: outPath, width: W, height: H, source: "emulator" };
  } catch {
    return null;
  }
}

export interface VmosScreenshotsOpts {
  uploadId: string;
  packageName: string;
  outDir: string;
  count?: number;
  startupDelayMs?: number;
  betweenFramesMs?: number;
}

export async function runVmosCloudScreenshots(
  opts: VmosScreenshotsOpts,
): Promise<GeneratedScreenshot[]> {
  const client: VmosCloudClient | null = vmosClientFromEnv();
  if (!client) throw new VmosCloudError("VMOS credentials not set");
  const padCode = getPadCode();
  if (!padCode) throw new VmosCloudError("VMOSCLOUD_PAD_CODE not set");
  const baseUrl = getPublicAppUrl();
  if (!baseUrl) throw new VmosCloudError("APP_PUBLIC_URL not set; cannot expose APK to VMOS");

  const apkUrl = `${baseUrl.replace(/\/+$/, "")}/api/uploads/${opts.uploadId}/apk`;
  await fs.mkdir(opts.outDir, { recursive: true });

  // 1. Install
  const installTaskId = await client.installApp(padCode, apkUrl);
  await client.waitForFileTask(installTaskId);

  try {
    // 2. Launch
    await client.startApp(padCode, opts.packageName);
    await new Promise((r) => setTimeout(r, opts.startupDelayMs ?? 8000));

    // 3. Capture frames
    const count = opts.count ?? 5;
    const results: GeneratedScreenshot[] = [];
    for (let i = 0; i < count; i++) {
      try {
        const previewUrl = await client.getPreviewUrl(padCode);
        const outPath = path.join(opts.outDir, `vmos-${i + 1}.png`);
        const shot = await fetchAndNormalize(previewUrl, outPath);
        if (shot) results.push(shot);
      } catch (err) {
        console.warn(`VMOS frame ${i + 1} failed:`, err);
      }
      // Nudge the UI between captures so we don't shoot the same frame.
      if (i < count - 1) {
        try {
          await client.swipe(padCode, Math.floor(W / 2), 1400, Math.floor(W / 2), 600);
        } catch {
          // swipe failures are non-fatal
        }
        await new Promise((r) => setTimeout(r, opts.betweenFramesMs ?? 2500));
      }
    }
    return results;
  } finally {
    // 4. Cleanup — stop + uninstall so we don't leave residue on the user's pad
    try {
      await client.stopApp(padCode, opts.packageName);
    } catch {
      /* ignore */
    }
    try {
      await client.uninstallApp(padCode, opts.packageName);
    } catch {
      /* ignore */
    }
  }
}

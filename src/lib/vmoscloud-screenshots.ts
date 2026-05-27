// VMOS Cloud screenshot orchestration:
//   1. Install the APK on the user's pre-provisioned VMOS pad
//      (padCode from env, or auto-detected from userPadList)
//   2. Launch the main activity
//   3. Capture N preview frames (with swipes between to walk the UI)
//   4. Stop + uninstall the APK so we leave the device clean
//
// The APK must be reachable from VMOS Cloud's network. We expose it from
// this app at /api/uploads/[id]/apk and pass the public URL through
// APP_PUBLIC_URL (or NEXT_PUBLIC_APP_URL).
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { vmosClientFromEnv, VmosCloudClient, VmosCloudError } from "./vmoscloud";
import type { GeneratedScreenshot } from "./screenshots";

const W = 1080;
const H = 1920;

function getPublicAppUrl(): string | null {
  return process.env.APP_PUBLIC_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? null;
}

function getPadCodeFromEnv(): string | null {
  return process.env.VMOSCLOUD_PAD_CODE ?? null;
}

async function resolvePadCode(client: VmosCloudClient): Promise<string> {
  const fromEnv = getPadCodeFromEnv();
  if (fromEnv) return fromEnv;
  const pads = await client.listUserPads();
  if (pads.length === 0) {
    throw new VmosCloudError(
      "No VMOS pads found on this account. Provision a pad in the VMOS console or set VMOSCLOUD_PAD_CODE.",
    );
  }
  // Prefer an online, non-trial pad
  const preferred = pads.find((p) => p.status === 1) ?? pads[0];
  return preferred.padCode;
}

async function fetchAndNormalize(
  url: string,
  outPath: string,
): Promise<GeneratedScreenshot | null> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
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
  const client = vmosClientFromEnv();
  if (!client) throw new VmosCloudError("VMOS credentials not set");

  const padCode = await resolvePadCode(client);
  const baseUrl = getPublicAppUrl();
  if (!baseUrl) {
    throw new VmosCloudError(
      "APP_PUBLIC_URL not set; cannot expose APK to VMOS Cloud",
    );
  }

  const apkUrl = `${baseUrl.replace(/\/+$/, "")}/api/uploads/${opts.uploadId}/apk`;
  await fs.mkdir(opts.outDir, { recursive: true });

  // 1. Install (uploadFileV3 with autoInstall=1)
  const installResults = await client.installApp([padCode], apkUrl, {
    packageName: opts.packageName,
    fileName: `${opts.packageName}.apk`,
    autoInstall: 1,
    isAuthorization: false,
  });
  const installTaskId = installResults[0]?.taskId;
  if (installTaskId) {
    try {
      await client.waitForFileTask(installTaskId, { timeoutMs: 5 * 60 * 1000 });
    } catch (err) {
      // installation might have succeeded even if poll fails - try to continue
      console.warn(`Install task ${installTaskId} did not complete cleanly:`, err);
    }
  }

  try {
    // 2. Launch
    try {
      await client.startApp([padCode], opts.packageName);
    } catch (err) {
      console.warn("startApp failed:", err);
    }
    await new Promise((r) => setTimeout(r, opts.startupDelayMs ?? 8000));

    // 3. Capture frames using the persistent preview URL
    const count = opts.count ?? 5;
    const results: GeneratedScreenshot[] = [];

    let previewUrl: string | null = null;
    try {
      const urls = await client.getLongGenerateUrl([padCode]);
      previewUrl = urls[0]?.url ?? urls[0]?.accessUrl ?? null;
    } catch (err) {
      console.warn("getLongGenerateUrl failed, will fall back to /screenshot per-frame:", err);
    }

    for (let i = 0; i < count; i++) {
      let frameUrl = previewUrl;
      // If long preview is unavailable, trigger a fresh screenshot for each frame
      if (!frameUrl) {
        try {
          const shots = await client.screenshot([padCode], {
            rotation: 0,
            resolutionWidth: W,
            resolutionHeight: H,
            definition: 90,
          });
          frameUrl = shots[0]?.accessUrl ?? shots[0]?.url ?? null;
        } catch (err) {
          console.warn(`VMOS screenshot ${i + 1} failed:`, err);
        }
      }
      if (frameUrl) {
        const outPath = path.join(opts.outDir, `vmos-${i + 1}.png`);
        const shot = await fetchAndNormalize(frameUrl, outPath);
        if (shot) results.push(shot);
      }
      // Nudge UI between captures
      if (i < count - 1) {
        try {
          await client.simulateSwipe(padCode, W / 2, 1400, W / 2, 600);
        } catch {
          /* non-fatal */
        }
        await new Promise((r) => setTimeout(r, opts.betweenFramesMs ?? 2500));
      }
    }
    return results;
  } finally {
    // 4. Cleanup
    try {
      await client.stopApp([padCode], opts.packageName);
    } catch {
      /* ignore */
    }
    try {
      await client.uninstallApp([padCode], opts.packageName);
    } catch {
      /* ignore */
    }
  }
}

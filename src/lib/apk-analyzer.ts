// Standalone APK analyzer: detect embedded third-party SDKs and dump full info.
//
// Detection works by decompressing the APK (zip) and scanning:
//   - classes*.dex buffers for SDK package-name signatures (DEX stores class
//     name strings as plaintext UTF-8),
//   - zip entry names (native libs, assets, META-INF) for path signatures.
import AdmZip from "adm-zip";
import { parseApk, type ParsedApk } from "./apk-parser";

export interface DetectedSdk {
  name: string;
  category: string;
  evidence: string; // what matched
}

export interface ApkAnalysis {
  apk: ParsedApk;
  sdks: DetectedSdk[];
  fileCount: number;
  dexCount: number;
  nativeAbis: string[];
  totalUncompressed: number;
}

interface SdkSignature {
  name: string;
  category: string;
  // package/class prefixes found in dex (plaintext), in slash or dot form
  classPatterns?: string[];
  // zip entry path fragments
  pathPatterns?: string[];
}

// Curated signature DB of common Android SDKs.
const SIGNATURES: SdkSignature[] = [
  { name: "Unity", category: "Game engine", classPatterns: ["com/unity3d/"], pathPatterns: ["libunity.so", "assets/bin/Data"] },
  { name: "Unreal Engine", category: "Game engine", pathPatterns: ["libUE4.so", "libUnreal.so"] },
  { name: "Flutter", category: "App framework", classPatterns: ["io/flutter/"], pathPatterns: ["libflutter.so", "flutter_assets"] },
  { name: "React Native", category: "App framework", classPatterns: ["com/facebook/react/"], pathPatterns: ["libreactnativejni.so", "index.android.bundle"] },
  { name: "Cocos2d", category: "Game engine", classPatterns: ["org/cocos2dx/"], pathPatterns: ["libcocos2d"] },
  { name: "Godot", category: "Game engine", classPatterns: ["org/godotengine/"], pathPatterns: ["libgodot"] },

  { name: "Huawei HMS Core", category: "Platform services", classPatterns: ["com/huawei/hms/"] },
  { name: "Huawei AppGallery (IAP/Ads)", category: "Platform services", classPatterns: ["com/huawei/agconnect/", "com/huawei/openalliance/"] },
  { name: "Google Mobile Services", category: "Platform services", classPatterns: ["com/google/android/gms/"] },
  { name: "Firebase", category: "Backend / analytics", classPatterns: ["com/google/firebase/"] },
  { name: "Google AdMob", category: "Ads", classPatterns: ["com/google/android/gms/ads/"] },
  { name: "Google Play Billing", category: "Monetization", classPatterns: ["com/android/billingclient/"] },

  { name: "Facebook SDK", category: "Social / analytics", classPatterns: ["com/facebook/"] },
  { name: "AppLovin MAX", category: "Ads", classPatterns: ["com/applovin/"] },
  { name: "ironSource", category: "Ads", classPatterns: ["com/ironsource/"] },
  { name: "Unity Ads", category: "Ads", classPatterns: ["com/unity3d/ads/", "com/unity3d/services/"] },
  { name: "Vungle", category: "Ads", classPatterns: ["com/vungle/"] },
  { name: "AdColony", category: "Ads", classPatterns: ["com/adcolony/"] },
  { name: "Mintegral", category: "Ads", classPatterns: ["com/mbridge/", "com/mintegral/"] },
  { name: "Pangle / TikTok Ads", category: "Ads", classPatterns: ["com/bytedance/sdk/openadsdk/", "com/pangle/"] },
  { name: "Chartboost", category: "Ads", classPatterns: ["com/chartboost/"] },
  { name: "InMobi", category: "Ads", classPatterns: ["com/inmobi/"] },
  { name: "Fyber / Digital Turbine", category: "Ads", classPatterns: ["com/fyber/"] },

  { name: "AppsFlyer", category: "Attribution", classPatterns: ["com/appsflyer/"] },
  { name: "Adjust", category: "Attribution", classPatterns: ["com/adjust/sdk/"] },
  { name: "Branch", category: "Attribution", classPatterns: ["io/branch/"] },
  { name: "Amplitude", category: "Analytics", classPatterns: ["com/amplitude/"] },
  { name: "Mixpanel", category: "Analytics", classPatterns: ["com/mixpanel/"] },
  { name: "Flurry", category: "Analytics", classPatterns: ["com/flurry/"] },
  { name: "Sentry", category: "Crash reporting", classPatterns: ["io/sentry/"] },
  { name: "Bugsnag", category: "Crash reporting", classPatterns: ["com/bugsnag/"] },

  { name: "OkHttp", category: "Networking", classPatterns: ["okhttp3/"] },
  { name: "Retrofit", category: "Networking", classPatterns: ["retrofit2/"] },
  { name: "Glide", category: "Image loading", classPatterns: ["com/bumptech/glide/"] },
  { name: "ExoPlayer", category: "Media", classPatterns: ["com/google/android/exoplayer2/", "androidx/media3/"] },
  { name: "Lottie", category: "UI / animation", classPatterns: ["com/airbnb/lottie/"] },
  { name: "Kotlin", category: "Language runtime", classPatterns: ["kotlin/"] },
  { name: "Jetpack Compose", category: "UI toolkit", classPatterns: ["androidx/compose/"] },
];

function toBufferPatterns(patterns: string[]): Buffer[] {
  // DEX stores class names in slash form (com/foo/Bar). Match the slash form.
  return patterns.map((p) => Buffer.from(p, "utf8"));
}

export async function analyzeApk(apkPath: string, outDir: string): Promise<ApkAnalysis> {
  const apk = await parseApk(apkPath, outDir);

  const zip = new AdmZip(apkPath);
  const entries = zip.getEntries();
  const fileCount = entries.length;

  const dexBuffers: Buffer[] = [];
  const entryNames: string[] = [];
  const nativeAbis = new Set<string>();
  let dexCount = 0;
  let totalUncompressed = 0;

  for (const e of entries) {
    const name = e.entryName;
    entryNames.push(name);
    totalUncompressed += e.header.size;
    if (/^classes\d*\.dex$/.test(name)) {
      dexCount++;
      try {
        dexBuffers.push(e.getData());
      } catch {
        /* skip undecodable dex */
      }
    }
    const abiMatch = name.match(/^lib\/([^/]+)\//);
    if (abiMatch) nativeAbis.add(abiMatch[1]);
  }

  const namesBlob = entryNames.join("\n");
  const detected: DetectedSdk[] = [];

  for (const sig of SIGNATURES) {
    let evidence: string | null = null;

    if (sig.pathPatterns) {
      for (const p of sig.pathPatterns) {
        if (namesBlob.includes(p)) {
          evidence = `file: ${p}`;
          break;
        }
      }
    }

    if (!evidence && sig.classPatterns) {
      const needles = toBufferPatterns(sig.classPatterns);
      outer: for (const dex of dexBuffers) {
        for (let i = 0; i < needles.length; i++) {
          if (dex.includes(needles[i])) {
            evidence = `class: ${sig.classPatterns[i]}`;
            break outer;
          }
        }
      }
    }

    if (evidence) detected.push({ name: sig.name, category: sig.category, evidence });
  }

  // Sort: frameworks/engines first, then by category for readability.
  const priority = (c: string) => (/engine|framework/i.test(c) ? 0 : 1);
  detected.sort((a, b) => priority(a.category) - priority(b.category) || a.name.localeCompare(b.name));

  return {
    apk,
    sdks: detected,
    fileCount,
    dexCount,
    nativeAbis: [...nativeAbis],
    totalUncompressed,
  };
}

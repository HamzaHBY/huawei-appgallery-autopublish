import { NextResponse } from "next/server";
import { getAiSettingsView, SK, type TextProvider } from "@/lib/ai-config";
import { setSetting, deleteSetting } from "@/lib/settings";

export const runtime = "nodejs";

export async function GET() {
  const view = await getAiSettingsView();
  return NextResponse.json(view);
}

interface SaveBody {
  textProvider?: string;
  textModel?: string;
  imageProvider?: string;
  imageModel?: string;
  // API keys: a non-empty string sets the key; the literal "__CLEAR__" removes it;
  // undefined / empty string leaves the stored value untouched.
  keys?: Partial<Record<TextProvider, string>>;
}

const CLEAR = "__CLEAR__";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as SaveBody;

  const selectionMap: Array<[string, string | undefined]> = [
    [SK.textProvider, body.textProvider],
    [SK.textModel, body.textModel],
    [SK.imageProvider, body.imageProvider],
    [SK.imageModel, body.imageModel],
  ];
  for (const [key, value] of selectionMap) {
    if (typeof value === "string" && value.trim().length > 0) {
      await setSetting(key, value.trim());
    }
  }

  const keySettingFor: Record<TextProvider, string> = {
    openai: SK.keyOpenai,
    deepseek: SK.keyDeepseek,
    gemini: SK.keyGemini,
  };
  if (body.keys) {
    for (const provider of Object.keys(body.keys) as TextProvider[]) {
      const val = body.keys[provider];
      if (val === undefined) continue;
      const settingKey = keySettingFor[provider];
      if (val === CLEAR) {
        await deleteSetting(settingKey);
      } else if (val.trim().length > 0) {
        await setSetting(settingKey, val.trim());
      }
    }
  }

  const view = await getAiSettingsView();
  return NextResponse.json(view);
}

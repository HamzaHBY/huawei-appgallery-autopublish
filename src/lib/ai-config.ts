// Central AI provider configuration.
//
// Lets the user pick — from Settings — which provider/model generates text
// (metadata, prompts) and images (screenshots), and store API keys per provider.
// All text providers are reached through the OpenAI SDK by swapping baseURL,
// since DeepSeek and Gemini both expose OpenAI-compatible endpoints.
import OpenAI from "openai";
import { getSetting, getSettingOrEnv } from "./settings";

export type TextProvider = "openai" | "deepseek" | "gemini";
export type ImageProvider = "openai" | "gemini";

// Setting keys
export const SK = {
  textProvider: "ai.text.provider",
  textModel: "ai.text.model",
  imageProvider: "ai.image.provider",
  imageModel: "ai.image.model",
  keyOpenai: "ai.key.openai",
  keyDeepseek: "ai.key.deepseek",
  keyGemini: "ai.key.gemini",
} as const;

const ENV_VAR: Record<TextProvider, string> = {
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  gemini: "GEMINI_API_KEY",
};

const KEY_SETTING: Record<TextProvider, string> = {
  openai: SK.keyOpenai,
  deepseek: SK.keyDeepseek,
  gemini: SK.keyGemini,
};

const BASE_URL: Record<TextProvider, string | undefined> = {
  openai: undefined, // SDK default
  deepseek: "https://api.deepseek.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
};

// Catalogs shown in the Settings dropdowns.
export const TEXT_MODELS: Record<TextProvider, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4-turbo"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
};

export const IMAGE_MODELS: Record<ImageProvider, string[]> = {
  // gpt-image-2 / 1.5 / 1-mini require OpenAI org verification on the account.
  openai: ["gpt-image-1", "gpt-image-2", "gpt-image-1.5", "gpt-image-1-mini", "dall-e-3"],
  gemini: ["gemini-2.5-flash-image"],
};

export const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  gemini: "Google Gemini",
};

const DEFAULT_TEXT_PROVIDER: TextProvider = "openai";
const DEFAULT_IMAGE_PROVIDER: ImageProvider = "openai";

function asTextProvider(v: string | null): TextProvider {
  return v === "deepseek" || v === "gemini" || v === "openai" ? v : DEFAULT_TEXT_PROVIDER;
}
function asImageProvider(v: string | null): ImageProvider {
  return v === "gemini" || v === "openai" ? v : DEFAULT_IMAGE_PROVIDER;
}

export async function getApiKey(provider: TextProvider): Promise<string | null> {
  return getSettingOrEnv(KEY_SETTING[provider], ENV_VAR[provider]);
}

export interface TextClient {
  client: OpenAI;
  model: string;
  provider: TextProvider;
}

// Resolve the active text client (provider + model + key) for chat completions.
export async function getTextClient(): Promise<TextClient> {
  const provider = asTextProvider(await getSetting(SK.textProvider));
  const model =
    (await getSetting(SK.textModel)) || TEXT_MODELS[provider][0] || "gpt-4o";
  const apiKey = await getApiKey(provider);
  if (!apiKey) {
    throw new Error(
      `No API key configured for ${PROVIDER_LABELS[provider]}. Add it in Settings or set ${ENV_VAR[provider]}.`,
    );
  }
  const client = new OpenAI({ apiKey, baseURL: BASE_URL[provider] });
  return { client, model, provider };
}

// Resolve the model to use for a specific image provider. If the user's active
// image provider matches, honor their chosen model; otherwise use that
// provider's default.
export async function resolveImageModel(provider: ImageProvider): Promise<string> {
  const active = asImageProvider(await getSetting(SK.imageProvider));
  if (active === provider) {
    const chosen = await getSetting(SK.imageModel);
    if (chosen && chosen.trim().length > 0) return chosen.trim();
  }
  return IMAGE_MODELS[provider][0];
}

export interface ImageConfig {
  provider: ImageProvider;
  model: string;
  apiKey: string;
}

// Resolve the active image-generation config for screenshots.
export async function getImageConfig(): Promise<ImageConfig> {
  const provider = asImageProvider(await getSetting(SK.imageProvider));
  const model =
    (await getSetting(SK.imageModel)) || IMAGE_MODELS[provider][0] || "gpt-image-1";
  const apiKey = await getApiKey(provider);
  if (!apiKey) {
    throw new Error(
      `No API key configured for ${PROVIDER_LABELS[provider]} (image). Add it in Settings or set ${ENV_VAR[provider]}.`,
    );
  }
  return { provider, model, apiKey };
}

// Current selection + which keys are present (for the Settings UI; never returns key values).
export async function getAiSettingsView() {
  const [textProvider, textModel, imageProvider, imageModel] = await Promise.all([
    getSetting(SK.textProvider),
    getSetting(SK.textModel),
    getSetting(SK.imageProvider),
    getSetting(SK.imageModel),
  ]);
  const keyState: Record<TextProvider, { fromDb: boolean; fromEnv: boolean }> = {
    openai: { fromDb: !!(await getSetting(SK.keyOpenai)), fromEnv: !!process.env.OPENAI_API_KEY },
    deepseek: { fromDb: !!(await getSetting(SK.keyDeepseek)), fromEnv: !!process.env.DEEPSEEK_API_KEY },
    gemini: { fromDb: !!(await getSetting(SK.keyGemini)), fromEnv: !!process.env.GEMINI_API_KEY },
  };
  return {
    textProvider: asTextProvider(textProvider),
    textModel: textModel || TEXT_MODELS[asTextProvider(textProvider)][0],
    imageProvider: asImageProvider(imageProvider),
    imageModel: imageModel || IMAGE_MODELS[asImageProvider(imageProvider)][0],
    textModels: TEXT_MODELS,
    imageModels: IMAGE_MODELS,
    providerLabels: PROVIDER_LABELS,
    keyState,
  };
}

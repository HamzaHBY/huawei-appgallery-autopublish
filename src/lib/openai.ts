import OpenAI from "openai";

let _client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

export const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o";
export const DEFAULT_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL ?? "dall-e-3";

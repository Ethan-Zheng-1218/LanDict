import type { TranslationProvider } from "./settingsStore";

export type AiProviderPreset = {
  id: TranslationProvider;
  label: string;
  /** Interface address filled in automatically; empty means the user types it. */
  baseUrl: string;
  /** Model used automatically; empty means the user types it. */
  model: string;
  hint: string;
  custom?: boolean;
};

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", hint: "接口地址与模型已自动填写" },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", hint: "接口地址与模型已自动填写" },
  { id: "openai-compatible", label: "自定义（OpenAI 兼容接口）", baseUrl: "", model: "", hint: "需要自己填写接口地址与模型名称", custom: true },
];

const FALLBACK_PRESET = AI_PROVIDER_PRESETS[AI_PROVIDER_PRESETS.length - 1];

export function findAiProviderPreset(provider: TranslationProvider): AiProviderPreset {
  return AI_PROVIDER_PRESETS.find((preset) => preset.id === provider) ?? FALLBACK_PRESET;
}

/** A preset already knows its endpoint and model, so those fields stay hidden. */
export function isCustomProvider(provider: TranslationProvider): boolean {
  return Boolean(findAiProviderPreset(provider).custom);
}

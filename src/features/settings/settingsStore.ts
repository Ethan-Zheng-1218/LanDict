import { dispatchStorageEvent, readStored, writeStored } from "../../lib/browserStorage";
import { findAiProviderPreset } from "./aiProviders";

export const SETTINGS_STORAGE_KEY = "landict.settings";
export const SETTINGS_CHANGED_EVENT = "landict-settings-changed";

export type TranslationProvider = "openai-compatible" | "deepseek" | "openai";

export type TranslationSettings = {
  enabled: boolean;
  provider: TranslationProvider;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
};

export type ReadingSettings = {
  /** Selecting (or double-clicking) a single word looks it up without pressing translate. */
  autoLookupWord: boolean;
  /** Accent used by the read-aloud voice; individual word buttons are unaffected. */
  voiceAccent: "en-GB" | "en-US";
};

export type QuerySettings = {
  /** Automatically expands and loads the AI translation card. */
  aiEnabled: boolean;
};

export type AppTheme = "lime" | "black" | "blue";
export type AppearanceSettings = { theme: AppTheme };

export type MouseLookupSettings = { enabled: boolean; delayMs: number; ocrEnabled: boolean };

export function normalizeMouseLookupSettings(value?: Partial<MouseLookupSettings>): MouseLookupSettings {
  return {
    enabled: typeof value?.enabled === "boolean" ? value.enabled : true,
    delayMs: typeof value?.delayMs === "number" && Number.isFinite(value.delayMs)
      ? Math.max(100, Math.min(3000, Math.round(value.delayMs))) : 500,
    ocrEnabled: typeof value?.ocrEnabled === "boolean" ? value.ocrEnabled : true,
  };
}

export type Settings = {
  translation: TranslationSettings;
  reading: ReadingSettings;
  query: QuerySettings;
  appearance: AppearanceSettings;
  mouseLookup: MouseLookupSettings;
};

export const DEFAULT_SETTINGS: Settings = {
  translation: {
    enabled: false,
    provider: "openai-compatible",
    apiBaseUrl: "",
    apiKey: "",
    model: "",
  },
  reading: {
    autoLookupWord: true,
    voiceAccent: "en-GB",
  },
  query: {
    aiEnabled: false,
  },
  appearance: { theme: "blue" },
  mouseLookup: normalizeMouseLookupSettings(),
};

function isStoredSettings(value: unknown): value is Partial<Settings> {
  if (!value || typeof value !== "object") return false;
  const translation = (value as { translation?: unknown }).translation;
  if (translation !== undefined) {
    if (!translation || typeof translation !== "object") return false;
    const item = translation as Partial<TranslationSettings>;
    if (typeof item.enabled !== "boolean"
      || (item.provider !== "openai-compatible" && item.provider !== "deepseek" && item.provider !== "openai")
      || typeof item.apiBaseUrl !== "string"
      || typeof item.apiKey !== "string"
      || typeof item.model !== "string") return false;
  }
  const reading = (value as { reading?: unknown }).reading;
  if (reading !== undefined) {
    if (!reading || typeof reading !== "object") return false;
    if (typeof (reading as Partial<ReadingSettings>).autoLookupWord !== "boolean") return false;
    const accent = (reading as Partial<ReadingSettings>).voiceAccent;
    if (accent !== undefined && accent !== "en-GB" && accent !== "en-US") return false;
  }
  const query = (value as { query?: unknown }).query;
  if (query !== undefined) {
    if (!query || typeof query !== "object") return false;
    if (typeof (query as Partial<QuerySettings>).aiEnabled !== "boolean") return false;
  }
  return true;
}

export function loadSettings(): Settings {
  const stored = readStored(SETTINGS_STORAGE_KEY, {}, isStoredSettings);
  const theme = stored.appearance?.theme;
  const translation = { ...DEFAULT_SETTINGS.translation, ...(stored.translation ?? {}) };
  // A preset owns its endpoint and model, so an earlier hand-typed value can never break a lookup.
  const preset = findAiProviderPreset(translation.provider);
  const normalizedTranslation = preset.custom ? translation : { ...translation, apiBaseUrl: preset.baseUrl, model: preset.model };
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    translation: normalizedTranslation,
    reading: { ...DEFAULT_SETTINGS.reading, ...(stored.reading ?? {}) },
    query: { ...DEFAULT_SETTINGS.query, ...(stored.query ?? {}) },
    appearance: { theme: theme === "lime" || theme === "black" || theme === "blue" ? theme : DEFAULT_SETTINGS.appearance.theme },
    mouseLookup: normalizeMouseLookupSettings(stored.mouseLookup),
  };
}

export function saveSettings(partial: Partial<Settings>): Settings {
  const current = loadSettings();
  const next: Settings = {
    ...current,
    ...partial,
    translation: { ...current.translation, ...(partial.translation ?? {}) },
    reading: { ...current.reading, ...(partial.reading ?? {}) },
    query: { ...current.query, ...(partial.query ?? {}) },
    appearance: { ...current.appearance, ...(partial.appearance ?? {}) },
    mouseLookup: normalizeMouseLookupSettings({ ...current.mouseLookup, ...partial.mouseLookup }),
  };
  writeStored(SETTINGS_STORAGE_KEY, next);
  dispatchStorageEvent(SETTINGS_CHANGED_EVENT);
  return next;
}

export function isAutoWordLookupEnabled(): boolean {
  return loadSettings().reading.autoLookupWord;
}

export function getReadingVoiceAccent(): "en-GB" | "en-US" {
  return loadSettings().reading.voiceAccent;
}

export function isQueryAiEnabled(): boolean {
  return loadSettings().query.aiEnabled;
}

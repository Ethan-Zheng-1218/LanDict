import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settingsStore";

describe("settings store", () => {
  beforeEach(() => window.localStorage.clear());

  it("migrates older settings and normalizes unsafe hover delays", () => {
    window.localStorage.setItem("landict.settings", JSON.stringify({ version: 1, data: {
      reading: { autoLookupWord: false, voiceAccent: "en-US" },
    } }));
    expect(loadSettings()).toMatchObject({
      mouseLookup: { enabled: true, delayMs: 500, ocrEnabled: true },
      reading: { autoLookupWord: false },
    });
    saveSettings({ mouseLookup: { enabled: false, delayMs: -20, ocrEnabled: false } });
    expect(loadSettings().mouseLookup).toEqual({ enabled: false, delayMs: 100, ocrEnabled: false });
    saveSettings({ mouseLookup: { enabled: true, delayMs: Number.NaN, ocrEnabled: true } });
    expect(loadSettings().mouseLookup.delayMs).toBe(500);
  });

  it("returns stable defaults when no settings have been saved", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("persists automatic AI without losing API credentials", () => {
    saveSettings({ query: { aiEnabled: true }, translation: { ...DEFAULT_SETTINGS.translation, apiBaseUrl: "https://ai.example/v1", apiKey: "saved-key", model: "demo" } });
    expect(loadSettings().query.aiEnabled).toBe(true);
    expect(loadSettings().translation.apiKey).toBe("saved-key");
  });

  it("adds the blue theme to older settings without losing reading preferences", () => {
    window.localStorage.setItem("landict.settings", JSON.stringify({ version: 1, data: {
      reading: { autoLookupWord: false, voiceAccent: "en-US" },
    } }));

    expect(loadSettings()).toMatchObject({
      appearance: { theme: "blue" },
      reading: { autoLookupWord: false, voiceAccent: "en-US" },
    });
  });

  it.each(["lime", "black", "blue"] as const)("persists the %s theme without resetting other settings", (theme) => {
    saveSettings({ reading: { autoLookupWord: false, voiceAccent: "en-US" } });
    saveSettings({ appearance: { theme } });

    expect(loadSettings()).toMatchObject({
      appearance: { theme },
      reading: { autoLookupWord: false, voiceAccent: "en-US" },
    });
  });

  it("falls back from an unknown theme without discarding saved preferences", () => {
    window.localStorage.setItem("landict.settings", JSON.stringify({ version: 1, data: {
      appearance: { theme: "white" },
      reading: { autoLookupWord: false, voiceAccent: "en-US" },
    } }));

    expect(loadSettings()).toMatchObject({
      appearance: { theme: "blue" },
      reading: { autoLookupWord: false, voiceAccent: "en-US" },
    });
  });

  it("persists translation API settings without losing other sections", () => {
    saveSettings({ translation: { ...DEFAULT_SETTINGS.translation, enabled: true, provider: "openai-compatible", apiBaseUrl: "https://api.example.com/v1", apiKey: "secret", model: "demo" } });

    expect(loadSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      translation: { ...DEFAULT_SETTINGS.translation, enabled: true, provider: "openai-compatible", apiBaseUrl: "https://api.example.com/v1", apiKey: "secret", model: "demo" },
    });
  });

  it("defaults the automatic word lookup to on and persists it when switched off", () => {
    expect(DEFAULT_SETTINGS.reading.autoLookupWord).toBe(true);

    saveSettings({ reading: { ...DEFAULT_SETTINGS.reading, autoLookupWord: false } });

    expect(loadSettings().reading.autoLookupWord).toBe(false);
    expect(loadSettings().translation).toEqual(DEFAULT_SETTINGS.translation);
  });

  it("replaces a hand-typed endpoint with the preset one for a known provider", () => {
    window.localStorage.setItem("landict.settings", JSON.stringify({ version: 1, data: {
      translation: { enabled: true, provider: "deepseek", apiBaseUrl: "https://platform.deepseek.com/api_keys", apiKey: "secret", model: "deepseek" },
    } }));

    expect(loadSettings().translation).toMatchObject({
      provider: "deepseek",
      apiBaseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      apiKey: "secret",
    });
  });

  it("keeps hand-typed values for the custom provider", () => {
    window.localStorage.setItem("landict.settings", JSON.stringify({ version: 1, data: {
      translation: { enabled: true, provider: "openai-compatible", apiBaseUrl: "https://my.gateway/v1", apiKey: "secret", model: "my-model" },
    } }));

    expect(loadSettings().translation).toMatchObject({ apiBaseUrl: "https://my.gateway/v1", model: "my-model" });
  });

});

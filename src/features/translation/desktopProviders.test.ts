import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { clearAiPanelCache, requestAiPanels } from "./aiTranslationProvider";
import { saveSettings } from "../settings/settingsStore";
import { resolveQuery } from "./translationService";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));

beforeEach(() => {
  window.localStorage.clear();
  vi.resetAllMocks();
  clearAiPanelCache();
  vi.stubGlobal("window", Object.assign(Object.create(window), { location: new URL("http://tauri.localhost/") }));
});
afterEach(() => vi.unstubAllGlobals());

const ECDICT_ENTRY = {
  word: "bank",
  phonetic: "bæŋk",
  definition: "bank",
  translation: "n. 银行, 河岸",
  pos: "n",
  exchange: "s:banks",
};

it("looks up word entries through the installed batch command without a dev server", async () => {
  vi.mocked(invoke).mockImplementation((command: string) => {
    if (command === "youdao_dictionary") return Promise.resolve({}) as never;
    if (command === "desktop_dictionary") return Promise.resolve({ entry: { word: "bank", phonetic: "bæŋk" } }) as never;
    return Promise.resolve({ bank: { ecdict: ECDICT_ENTRY } }) as never;
  });

  const result = await resolveQuery("bank", undefined, { ai: false });
  expect(result.kind).toBe("word");
  if (result.kind === "word") {
    expect(result.status).toBe("success");
    expect(result.meaning).toContain("银行");
    // 桌面版的音标来源与改动前一致：没有牛津 IPA 时用适配层从 ECDICT 音标推出的写法。
    expect(result.britishPhonetic).toContain("bæŋk");
  }
  expect(invoke).toHaveBeenCalledWith(
    "dictionary_lookup",
    expect.objectContaining({ words: expect.arrayContaining(["bank"]) }),
  );
  expect(invoke).toHaveBeenCalledWith("desktop_dictionary", expect.objectContaining({ word: "bank" }));
});

it("resolves an inflected form through the batch command's lemma candidates", async () => {
  vi.mocked(invoke).mockImplementation(((command: string, args?: Record<string, unknown>) => {
    if (command === "youdao_dictionary") return Promise.resolve({}) as never;
    if (command === "desktop_dictionary") return Promise.resolve({ entry: { word: "run", phonetic: "rʌn" } }) as never;
    expect(args?.words).toEqual(expect.arrayContaining(["ran", "run"]));
    return Promise.resolve({ ran: {}, run: { ecdict: { ...ECDICT_ENTRY, word: "run", translation: "n. 跑步" } } }) as never;
  }) as never);

  const result = await resolveQuery("ran", undefined, { ai: false });
  if (result.kind === "word") {
    expect(result.status).toBe("success");
    expect(result.entries[0]?.word).toBe("run");
    expect(result.resolvedWord).toBe("run");
  }
});

it("returns an empty result rather than throwing when nothing matches", async () => {
  vi.mocked(invoke).mockImplementation((command: string) => {
    if (command === "desktop_dictionary") return Promise.resolve({}) as never;
    return Promise.resolve({ qqxzvnotaword: {} }) as never;
  });
  const result = await resolveQuery("qqxzvnotaword", undefined, { ai: false });
  if (result.kind === "word") expect(result.status).toBe("empty");
});

it("uses the native Youdao bridge for online dictionary results without a dev server", async () => {
  vi.mocked(invoke).mockResolvedValue({ ec: { word: [{
    "return-phrase": { l: { i: "Tauri" } }, trs: [{ tr: [{ l: { i: ["adj. 金牛座的"] } }] }],
  }] } });
  const result = await resolveQuery("tauri", undefined, { ai: false });
  expect(result).toMatchObject({ status: "success", source: "有道词典", meaning: "金牛座的" });
  expect(invoke).toHaveBeenCalledOnce();
  expect(invoke).toHaveBeenCalledWith("youdao_dictionary", expect.objectContaining({ word: "tauri" }));
  expect(result.panels).toHaveLength(1);
});

it("returns contextual AI output through the native HTTP bridge", async () => {
  saveSettings({ translation: { enabled: true, provider: "openai-compatible", apiBaseUrl: "https://ai.example/v1", apiKey: "secret", model: "demo" } });
  vi.mocked(invoke).mockResolvedValue({ status: 200, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ cards: [{ id: "ai-context", title: "", body: "在本句中指河岸。" }] }) } }] }) });
  const panels = await requestAiPanels({ text: "bank", mode: "word", context: "He sat on the bank." });
  expect(panels[0].body).toBe("在本句中指河岸。");
  expect(invoke).toHaveBeenCalledWith("desktop_ai_request", expect.objectContaining({
    messages: expect.arrayContaining([expect.objectContaining({ role: "user", content: expect.stringContaining("He sat on the bank.") })]),
  }));
});

import { afterEach, expect, it, vi } from "vitest";
import { lookupYoudaoDictionary, parseYoudaoDictionary } from "./youdaoDictionary";
import { resolveQuery } from "./translationService";

const payload = {
  ec: { word: [{ "return-phrase": { l: { i: "Tauri" } }, phone: "'tɔ:rai", trs: [
    { tr: [{ l: { i: ["adj. 金牛座的"] } }] },
  ], wfs: [{ wf: { name: "复数", value: "tauris" } }] }] },
  blng_sents_part: { "sentence-pair": [{ sentence: "Tauri is a name.", "sentence-translation": "这是一个名字。" }] },
  phrs: { phrs: [{ phr: { headword: { l: { i: "T Tauri" } }, trs: [{ tr: { l: { i: "金牛座T型星" } } }] } }] },
};

const chinesePayload = {
  ce: { word: [{ "return-phrase": { l: { i: "放弃" } }, phone: "fàng qì", trs: [
    { tr: [{ l: { pos: "vt.", i: ["", { "#text": "abandon" }], "#tran": "放弃，抛弃" } }] },
    { tr: [{ l: { i: ["", { "#text": "give" }, " ", { "#text": "up" }], "#tran": "放弃，停止" } }] },
  ] }] },
};

afterEach(() => vi.unstubAllGlobals());

it("adapts dictionary definitions, examples, phrases and forms without using AI or web guesses", () => {
  const result = parseYoudaoDictionary("tauri", payload);
  expect(result).toMatchObject({ status: "success", query: "tauri", source: "有道词典", meaning: "金牛座的" });
  expect(result?.panels[0]).toMatchObject({ id: "ecdict", label: "词库解释" });
  expect(result?.entries[0]).toMatchObject({
    source: "Youdao", word: "Tauri", meanings: [{ partOfSpeech: "adj.", translations: ["金牛座的"] }],
    examples: [{ text: "Tauri is a name.", translation: "这是一个名字。" }],
    collocations: ["T Tauri"], collocationTranslations: { "T Tauri": "金牛座T型星" },
    wordForms: [{ label: "复数", value: "tauris" }],
  });
  expect(result?.resolvedWord).toBeUndefined(); // 大小写变化不是词形还原。
  for (const data of [null, {}, { ec: { word: {} } }, { ec: { word: [{ trs: "bad" }] } }, { web_trans: {}, aiDefinition: "猜测" }]) {
    expect(parseYoudaoDictionary("tauri", data)).toBeUndefined();
  }
});

it("prefers online dictionary meanings and keeps the independent AI placeholder", async () => {
  const fetcher = vi.fn(async (_url: string) => ({ ok: true, json: async () => payload }));
  vi.stubGlobal("fetch", fetcher);
  const result = await resolveQuery("tauri");
  expect(result).toMatchObject({ status: "success", source: "有道词典", meaning: "金牛座的" });
  expect(result.panels.map(panel => panel.label)).toEqual(["词库解释", "AI 翻译"]);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]?.[0]).toBe("/api/youdao-dictionary?word=tauri");
});

it("adapts Chinese-English entries and preserves spaces inside English expressions", () => {
  const result = parseYoudaoDictionary("放弃", chinesePayload);
  expect(result).toMatchObject({ kind: "word", query: "放弃", status: "success", source: "有道词典" });
  expect(result?.entries).toMatchObject([
    { word: "abandon", source: "Youdao", meanings: [{ partOfSpeech: "vt.", translations: ["放弃，抛弃"] }] },
    { word: "give up", meanings: [{ translations: ["放弃，停止"] }] },
  ]);
  expect(result?.meaning).toContain("give up");
  expect(result?.panels[0].label).toBe("词库解释");
  expect(result?.britishPhonetic).toBe("—");
  expect(parseYoudaoDictionary("猫", chinesePayload)).toBeUndefined();
  expect(parseYoudaoDictionary("放弃", { ce: { word: [{ trs: [{ tr: [{ l: { i: [{ "#text": 42 }] } }] }] }] } })).toBeUndefined();
});

it("requires an explicit exact dictionary headword for English phrases and Chinese terms", () => {
  expect(parseYoudaoDictionary("look forward to", { ec: { word: [{ trs: [{ tr: [{ l: { i: ["期待"] } }] }] }] } })).toBeUndefined();
  expect(parseYoudaoDictionary("计算机", { ce: { word: [{ trs: [{ tr: [{ l: { i: ["computer"] } }] }] }] } })).toBeUndefined();
});

it.each(["https://example.com", "look\nforward", "look\tforward", "one two three four five six seven", "一二三四五六七八九十一二三", "a".repeat(81)])("rejects unsupported lookup input %s before making a request", async query => {
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  expect(await lookupYoudaoDictionary(query)).toBeUndefined();
  expect(network).not.toHaveBeenCalled();
});

it("queries Youdao for Chinese words before using local reverse lookup", async () => {
  const fetcher = vi.fn(async (_url: string) => ({ ok: true, json: async () => chinesePayload }));
  vi.stubGlobal("fetch", fetcher);
  const result = await resolveQuery("放弃");
  expect(result).toMatchObject({ status: "success", source: "有道词典" });
  expect(result.panels.map(panel => panel.label)).toEqual(["词库解释", "AI 翻译"]);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/youdao-dictionary?word=${encodeURIComponent("放弃")}`);
});

it.each(["offline", "failure", "missing", "malformed"])("keeps Chinese local reverse lookup and the AI panel on %s", async mode => {
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(mode !== "offline");
  const fetcher = vi.fn(async (url: string) => {
    if (url.startsWith("/api/youdao-dictionary")) {
      if (mode === "failure") throw new Error("network unavailable");
      return { ok: true, json: async () => mode === "missing" ? {} : { ce: { word: "bad" } } };
    }
    return { ok: true, json: async () => url === "/api/dictionary-reverse"
      ? { hits: [{ word: "abandon", source: "cedict", rank: 2000 }] }
      : { hits: { abandon: { ecdict: { word: "abandon", translation: "v. 放弃", definition: "give up", phonetic: "", pos: "v", exchange: "" } } } } };
  });
  vi.stubGlobal("fetch", fetcher);
  try {
    const result = await resolveQuery("放弃");
    expect(result).toMatchObject({ status: "success", meaning: "abandon　放弃" });
    expect(result.panels.map(panel => panel.label)).toEqual(["词库解释", "AI 翻译"]);
    if (mode === "offline") expect(fetcher.mock.calls.every(([url]) => !url.includes("youdao"))).toBe(true);
  } finally { online.mockRestore(); }
});

it.each(["offline", "failure", "missing", "malformed"])("falls back to the local dictionary on %s", async mode => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(mode !== "offline");
  const fetcher = vi.fn(async (url: string) => {
    if (url.startsWith("/api/youdao-dictionary")) {
      if (mode === "failure") throw new Error("network unavailable");
      return { ok: true, json: async () => mode === "missing" ? {} : { ec: { word: "bad" } } };
    }
    return { ok: true, json: async () => ({ hits: { cat: { ecdict: {
      word: "cat", translation: "n. 猫", definition: "feline", phonetic: "kæt", pos: "n", exchange: "",
    } } } }) };
  });
  vi.stubGlobal("fetch", fetcher);
  try {
    expect(await resolveQuery("cat")).toMatchObject({ status: "success", meaning: "猫" });
    if (mode === "offline") expect(fetcher.mock.calls.every(([url]) => !url.includes("youdao"))).toBe(true);
  } finally { vi.restoreAllMocks(); }
});

it("does not start a local fallback after the user cancels an online lookup", async () => {
  const controller = new AbortController();
  const fetcher = vi.fn(async () => { controller.abort(); throw new DOMException("cancelled", "AbortError"); });
  vi.stubGlobal("fetch", fetcher);
  await expect(resolveQuery("tauri", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(fetcher).toHaveBeenCalledOnce();
});

it("falls back after four seconds when the online request hangs", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (url.startsWith("/api/youdao-dictionary")) return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")));
    });
    return Promise.resolve({ ok: true, json: async () => ({ hits: {} }) });
  }));
  try {
    const pending = resolveQuery("tauri");
    await vi.advanceTimersByTimeAsync(4000);
    expect(await pending).toMatchObject({ status: "empty", panels: [{ label: "词库解释", body: "词库暂未收录这个单词。" }, { id: "ai" }] });
  } finally { vi.useRealTimers(); }
});

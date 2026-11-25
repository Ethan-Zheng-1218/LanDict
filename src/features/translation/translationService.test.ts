import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { classifyQuery, getQueryResult, loadAiPanels, mergeAiPanels, resolveQuery, translateDemo } from "./translationService";
import * as aiProvider from "./aiTranslationProvider";
import { translateLocally } from "./localTranslationProvider";

vi.mock("./localTranslationProvider", () => ({ translateLocally: vi.fn() }));

describe("translation service", () => {
  beforeEach(() => { vi.stubGlobal("fetch", undefined); vi.mocked(translateLocally).mockReset(); });
  afterEach(() => vi.unstubAllGlobals());

  it("classifies a single English word as a dictionary lookup", () => {
    expect(classifyQuery("serendipity")).toBe("word");
  });

  it("distinguishes phrases from sentences and paragraphs", () => {
    expect(classifyQuery("look forward to")).toBe("phrase");
    expect(classifyQuery("I look forward to seeing you.")).toBe("text");
  });

  it("treats a short Chinese word as a dictionary lookup", () => {
    expect(classifyQuery("猫")).toBe("word");
  });

  it("treats a Chinese sentence as an AI translation", () => {
    expect(classifyQuery("你吃饭了吗")).toBe("text");
  });

  it("forwards the selected word learning category to the AI request", async () => {
    const request = vi.spyOn(aiProvider, "requestAiPanels").mockResolvedValueOnce([]);
    try {
      await loadAiPanels("create", { mode: "word", learning: "derivatives" });
      expect(request).toHaveBeenCalledWith({ text: "create", mode: "word", learning: "derivatives" }, undefined);
    } finally { request.mockRestore(); }
  });

  it.each([
    { query: "look forward to", kind: "phrase", payload: { ec: { word: [{ "return-phrase": { l: { i: "look forward to" } }, trs: [{ tr: [{ l: { i: ["期待；盼望"] } }] }] }] } }, meaning: "期待；盼望" },
    { query: "计算机", kind: "text", payload: { ce: { word: [{ "return-phrase": { l: { i: "计算机" } }, trs: [{ tr: [{ l: { i: [{ "#text": "computer" }], "#tran": "计算机" } }] }] }] } }, meaning: "computer　计算机" },
  ])("prefers exact online dictionary matches for $query without making it a saved word", async ({ query, kind, payload, meaning }) => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => payload })));
    const result = await resolveQuery(query);
    expect(result).toMatchObject({ kind, query, status: "success", panels: [
      { id: "local", label: "词库解释", title: "有道词典", body: meaning },
      { id: "ai", badge: "点击展开" },
    ] });
    expect(result).not.toHaveProperty("entries");
    expect(translateLocally).not.toHaveBeenCalled();
  });

  it.each(["look forward to", "计算机", "你吃饭了吗"])("keeps local translation when %s has no exact dictionary entry", async query => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ce: { word: [{ "return-phrase": { l: { i: "吃饭" } }, trs: [{ tr: [{ l: { i: ["eat"] } }] }] }] } }) })));
    vi.mocked(translateLocally).mockResolvedValue({ translation: "本地模型的译文", source: "zh", target: "en" });
    const result = await resolveQuery(query);
    expect(result).toMatchObject({ kind: query === "look forward to" ? "phrase" : "text", status: "success", panels: [
      { id: "local", label: "本地翻译", title: "英文翻译", body: "本地模型的译文" }, { id: "ai" },
    ] });
    expect(translateLocally).toHaveBeenCalledWith(query, undefined);
  });

  it.each(["I look forward to seeing you.", "今天我们准备一起去公园散步然后吃晚饭", "今天去公园。"])("uses only local translation for sentence %s", async query => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    vi.mocked(translateLocally).mockResolvedValue({ translation: "本地译文", source: "en", target: "zh" });
    expect(await resolveQuery(query)).toMatchObject({ kind: "text", status: "success", panels: [{ label: "本地翻译", body: "本地译文" }, { id: "ai" }] });
    expect(network).not.toHaveBeenCalled();
  });

  it("does not start local translation when a phrase dictionary request is cancelled", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => { controller.abort(); throw new DOMException("cancelled", "AbortError"); }));
    await expect(resolveQuery("look forward to", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(translateLocally).not.toHaveBeenCalled();
  });

  it("prepares one ECDICT panel and an independent AI panel for word queries", () => {
    const result = getQueryResult("serendipity");

    expect(result.kind).toBe("word");
    if (result.kind !== "word") throw new Error("expected a word result");
    expect(result.status).toBe("loading");
    expect(result.panels.map((panel) => panel.id)).toEqual(["ecdict", "ai"]);
    expect(result.entries).toEqual([]);
  });

  it("keeps the AI card collapsed until the reader expands it", () => {
    const result = getQueryResult("look forward to");

    expect(result.kind).toBe("phrase");
    expect(result.panels).toHaveLength(2);
    expect(result.panels[0].id).toBe("local");
    expect(result.panels[1].id).toBe("ai");
    expect(result.panels[1].label).toBe("AI 翻译");
    expect(result.panels[1].badge).toBe("点击展开");
    expect(result.panels[1].body).toContain("展开后调用 AI");
  });

  it("returns an ECDICT loading result for a demo word", () => {
    expect(translateDemo("serendipity")).toMatchObject({
      kind: "word",
      title: "serendipity",
      source: "词库解释",
    });
  });

  it("returns an AI translation placeholder for text", () => {
    expect(translateDemo("look forward to")).toMatchObject({
      kind: "text",
      provider: "本地翻译",
    });
  });

  it("resolves a word from the batch lookup endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hits: { serendipity: { ecdict: { word: "serendipity", phonetic: "serәn'dipiti", definition: "n. good luck", translation: "n. 意外发现珍奇事物的本领", pos: "n:100", exchange: "s:serendipities" } } } }),
    }));
    const result = await resolveQuery("serendipity");

    expect(result).toMatchObject({ kind: "word", status: "success", query: "serendipity" });
    if (result.kind !== "word") throw new Error("expected a word result");
    expect(result.entries[0]).toMatchObject({ source: "ECDICT", meaning: expect.stringContaining("意外") });
  });

  it("marks an unknown word as empty after ECDICT returns no entry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ entry: null }) }));
    await expect(resolveQuery("unknownword")).resolves.toMatchObject({ kind: "word", status: "empty" });
  });

  it("does not mark a working dictionary as unavailable when AI translation fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hits: {
      cat: { ecdict: { word: "cat", phonetic: "kæt", definition: "feline", translation: "n. 猫", pos: "n:100", exchange: "s:cats" } },
    } }) }));
    const result = mergeAiPanels(await resolveQuery("cat"), [{ id: "ai-error", label: "AI 翻译", badge: "未配置", title: "AI 调用未完成", body: "未配置接口" }]);

    expect(result).toMatchObject({ kind: "word", status: "success", entries: [{ word: "cat" }] });
    expect(result.panels.map((panel) => panel.id)).toEqual(["ecdict", "ai-error"]);
  });

  it.each(["empty", "error"] as const)("preserves the dictionary %s status when AI succeeds", (status) => {
    const base = getQueryResult("cat");
    if (base.kind !== "word") throw new Error("expected word result");
    expect(mergeAiPanels({ ...base, status }, [{ id: "ai-daily", label: "AI 翻译", badge: "", title: "解释", body: "猫" }]).status).toBe(status);
  });

  it("lists English candidates for a Chinese word through the reverse endpoint", async () => {
    // 中文反查现在返回候选词列表，不再把第一个候选的释义当结果——候选本身没有中文释义可展示。
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hits: [
      { word: "cat", source: "cedict", rank: 1712 },
      { word: "feline", source: "oxford", senseIndex: 0, rank: 23868 },
    ] }) }));
    const result = await resolveQuery("猫");

    expect(result).toMatchObject({ kind: "word", status: "success" });
    if (result.kind !== "word") throw new Error("expected a word result");
    expect(result.panels[0].body).toBe("cat\nfeline");
    expect(result.meaning).toBe("cat\nfeline");
  });
});

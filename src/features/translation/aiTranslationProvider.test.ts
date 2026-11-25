import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearAiPanelCache, describeAiError, parseAiPanels, requestAiPanels, testAiConnection, translateWithStatus, unconfiguredAiProvider, type AiTranslationProvider } from "./aiTranslationProvider";
import { DEFAULT_SETTINGS, saveSettings } from "../settings/settingsStore";

describe("AI translation provider status", () => {
  it("returns an unconfigured state without calling the provider", async () => {
    const provider = { ...unconfiguredAiProvider, translate: vi.fn(unconfiguredAiProvider.translate) };

    const result = await translateWithStatus(provider, { text: "look forward to", mode: "phrase" });

    expect(result).toMatchObject({ status: "unconfigured", message: expect.stringContaining("尚未配置") });
    expect(provider.translate).not.toHaveBeenCalled();
  });

  it("returns success and error states for configured providers", async () => {
    const provider: AiTranslationProvider = {
      id: "test",
      name: "测试 AI",
      isConfigured: () => true,
      translate: vi.fn()
        .mockResolvedValueOnce({ translation: "期待", explanation: "表示期待某事" })
        .mockRejectedValueOnce(new Error("服务不可用")),
    };

    await expect(translateWithStatus(provider, { text: "look forward to", mode: "phrase" })).resolves.toMatchObject({
      status: "success",
      response: { translation: "期待" },
    });
    await expect(translateWithStatus(provider, { text: "hello", mode: "text" })).resolves.toMatchObject({
      status: "error",
      message: "服务不可用",
    });
  });
});

function configureAi() {
  saveSettings({
    translation: { ...DEFAULT_SETTINGS.translation, enabled: true, apiBaseUrl: "https://ai.example/v1", apiKey: "secret", model: "demo-model" },
  });
}

function completion(content: string) {
  return { ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify({ choices: [{ message: { content } }] }) };
}

describe("AI panel requests", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearAiPanelCache();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("asks for two Chinese versions of a sentence and merges them into the expected cards", async () => {
    configureAi();
    const fetchMock = vi.fn().mockResolvedValue(completion(JSON.stringify({
      cards: [
        { id: "daily", title: "日常表达", body: "他们期待这次会面。" },
        { id: "academic", title: "书面表达", body: "他们对此番会面抱有期待。" },
      ],
    })));
    vi.stubGlobal("fetch", fetchMock);

    const panels = await requestAiPanels({ text: "They look forward to the meeting.", mode: "text" });

    expect(panels).toEqual([
      { id: "ai-daily", label: "AI 翻译", badge: "", title: "日常表达", body: "他们期待这次会面。" },
      { id: "ai-academic", label: "AI 翻译", badge: "", title: "书面表达", body: "他们对此番会面抱有期待。" },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe("/api/ai-translate");
    expect(init.body).toContain("两个中文版本");
  });

  it("only asks for one news-register version inside the reader", async () => {
    configureAi();
    const fetchMock = vi.fn().mockResolvedValue(completion(JSON.stringify({ cards: [{ id: "news", title: "新闻体翻译", body: "警方表示抗议者被带走。" }] })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestAiPanels({ text: "Police said protesters were removed.", mode: "text", register: "news" })).resolves.toEqual([
      { id: "ai-news", label: "AI 翻译", badge: "", title: "", body: "警方表示抗议者被带走。" },
    ]);
    expect((fetchMock.mock.calls[0] as [string, { body: string }])[1].body).toContain("新闻体");
  });

  it("translates Chinese phrases and sentences into English", async () => {
    configureAi();
    const fetchMock = vi.fn().mockResolvedValue(completion(JSON.stringify({ cards: [
      { id: "english", title: "英文翻译", body: "Have you eaten?" },
    ] })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestAiPanels({ text: "你吃饭了吗", mode: "text" })).resolves.toEqual([
      { id: "ai-english", label: "AI 翻译", badge: "", title: "英文翻译", body: "Have you eaten?" },
    ]);
    const body = (fetchMock.mock.calls[0] as [string, { body: string }])[1].body;
    expect(body).toContain("翻译成自然、准确的英文");
    expect(body).not.toContain("两个中文版本");
  });

  it("explains English equivalents and usage when looking up a Chinese word", async () => {
    configureAi();
    const fetchMock = vi.fn().mockResolvedValue(completion(JSON.stringify({ cards: [
      { id: "ai-word", title: "", body: "英文表达：abandon；give up。\n\n用法区别：abandon 强调舍弃。\n\n例句：Never give up.\n永不放弃。" },
    ] })));
    vi.stubGlobal("fetch", fetchMock);
    const panels = await requestAiPanels({ text: "放弃", mode: "word" });
    expect(panels[0]).toMatchObject({ id: "ai-word", label: "AI 翻译", body: expect.stringContaining("abandon") });
    const body = (fetchMock.mock.calls[0] as [string, { body: string }])[1].body;
    expect(body).toContain("中文词语：放弃");
    expect(body).toContain("英文表达");
    expect(body).toContain("用法区别");
    expect(body).not.toContain("本地词典已经给出基本释义和音标");
  });

  it("sends the surrounding sentence when asking for a contextual word meaning", async () => {
    configureAi();
    const fetchMock = vi.fn().mockResolvedValue(completion(JSON.stringify({ cards: [{ id: "context", title: "在本文中的意思", body: "此处指“表现形式”。" }] })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestAiPanels({ text: "manifestation", mode: "word", context: "The real manifestation of Zionism has been the destruction of villages." })).resolves.toEqual([
      { id: "ai-context", label: "AI 语境义", badge: "", title: "", body: "此处指“表现形式”。" },
    ]);
    expect((fetchMock.mock.calls[0] as [string, { body: string }])[1].body).toContain("一共两段");
    expect((fetchMock.mock.calls[0] as [string, { body: string }])[1].body).toContain("destruction of villages");
  });

  it("falls back to plain text when the model ignores the JSON contract", async () => {
    const specs = { cards: [{ id: "usage", label: "AI 学习卡", badge: "搭配与用法", title: "用法与搭配", instruction: "" }], task: "task" };

    expect(parseAiPanels("用法：常与 for 连用。", specs)).toEqual([
      { id: "usage", label: "AI 学习卡", badge: "搭配与用法", title: "用法与搭配", body: "用法：常与 for 连用。" },
    ]);
  });

  it.each([
    ["examples", "例句", "实际义项", "英文例句", "中文翻译"],
    ["roots", "词根", "词缀", "含义联系", "不要编造"],
    ["synonyms", "近义词", "词性", "中文释义", "用法区别"],
    ["antonyms", "反义词", "词性", "中文释义", "没有固定反义词"],
    ["derivatives", "派生词", "不同拼写", "真正的派生关系", "没有常见派生词"],
  ] as const)("asks only for numbered %s learning content", async (learning, label, ...requirements) => {
    configureAi();
    const body = "1. 捕获\nThe bird was captured.\n小鸟被捕获了。";
    const fetchMock = vi.fn().mockResolvedValue(completion(JSON.stringify({ cards: [{ id: `ai-learning-${learning}`, body }] })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestAiPanels({ text: "capture", mode: "word", learning })).resolves.toEqual([
      { id: `ai-learning-${learning}`, label: "AI 翻译", badge: "", title: "", body },
    ]);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    const prompt = payload.messages[1].content;
    expect(prompt).toContain(label);
    expect(prompt).toContain("1.");
    expect(prompt).toContain("空行");
    expect(prompt).toContain("HTML");
    for (const requirement of requirements) expect(prompt).toContain(requirement);
    expect(prompt).not.toContain("一共三段");
  });

  it("excludes inflections, unchanged spelling and merely shared roots from derivatives", async () => {
    configureAi();
    const fetchMock = vi.fn().mockResolvedValue(completion("没有常见派生词。"));
    vi.stubGlobal("fetch", fetchMock);

    await requestAiPanels({ text: "water", mode: "word", learning: "derivatives" });

    const prompt = JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content;
    for (const excluded of ["captured", "capturing", "复数", "water", "同根词"]) expect(prompt).toContain(excluded);
  });

  it("keeps the existing word translation prompt when learning is not requested", async () => {
    configureAi();
    const fetchMock = vi.fn().mockResolvedValue(completion("用法：说明。"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestAiPanels({ text: "capture", mode: "word" })).resolves.toMatchObject([{ id: "ai-word" }]);

    const prompt = JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content;
    expect(prompt).toContain("一共三段");
    expect(prompt).toContain("常见搭配");
    expect(prompt).not.toContain("ai-learning-");
  });

  it.each(["  Capture  ", "mother-in-law", "can't"])("supports a single English word %s without confusing reader context with learning", async (text) => {
    configureAi();
    const fetchMock = vi.fn().mockResolvedValue(completion("1. 学习内容"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestAiPanels({ text, mode: "word", context: "Some article context.", learning: "examples" })).resolves.toMatchObject([{ id: "ai-learning-examples" }]);

    const prompt = JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content;
    expect(prompt).toContain(`目标单词：${text.trim()}\n`);
    expect(prompt).not.toContain("它所在的句子");
  });

  it.each([
    { text: "look forward to", mode: "phrase" },
    { text: "capture the moment", mode: "word" },
    { text: "捕获", mode: "word" },
    { text: "capture.", mode: "word" },
    { text: "", mode: "word" },
    { text: "capture", mode: "text" },
  ] as const)("rejects word learning for $text in $mode mode before the API call", async (request) => {
    configureAi();
    const fetchMock = vi.fn().mockResolvedValue(completion("不应请求"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestAiPanels({ ...request, learning: "examples" })).rejects.toMatchObject({ kind: "validation" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps each learning category and normal translation in separate cache entries", async () => {
    configureAi();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completion("例句内容"))
      .mockResolvedValueOnce(completion("词根内容"))
      .mockResolvedValueOnce(completion("普通翻译内容"));
    vi.stubGlobal("fetch", fetchMock);

    await requestAiPanels({ text: "capture", mode: "word", learning: "examples" });
    await expect(requestAiPanels({ text: "capture", mode: "word", learning: "roots" })).resolves.toMatchObject([{ body: "词根内容" }]);
    await expect(requestAiPanels({ text: "capture", mode: "word" })).resolves.toMatchObject([{ body: "普通翻译内容" }]);
    await expect(requestAiPanels({ text: "capture", mode: "word", learning: "examples" })).resolves.toMatchObject([{ body: "例句内容" }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    { apiKey: "other!" },
    { apiBaseUrl: "https://another.example/v1" },
    { model: "other-model" },
  ])("isolates cached panels when credentials change: %j", async (change) => {
    configureAi();
    const fetchMock = vi.fn().mockResolvedValueOnce(completion("旧接口内容")).mockResolvedValueOnce(completion("新接口内容"));
    vi.stubGlobal("fetch", fetchMock);
    const request = { text: "capture", mode: "word" } as const;
    await requestAiPanels(request);
    saveSettings({ translation: { ...DEFAULT_SETTINGS.translation, enabled: true, apiBaseUrl: "https://ai.example/v1", apiKey: "secret", model: "demo-model", ...change } });

    await expect(requestAiPanels(request)).resolves.toMatchObject([{ body: "新接口内容" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects an already aborted request even when a cached response exists", async () => {
    configureAi();
    const fetchMock = vi.fn().mockResolvedValue(completion("已缓存内容"));
    vi.stubGlobal("fetch", fetchMock);
    const request = { text: "capture", mode: "word" } as const;
    await requestAiPanels(request);
    const controller = new AbortController();
    controller.abort();

    await expect(requestAiPanels(request, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects an already aborted uncached request without calling the API", async () => {
    configureAi();
    const fetchMock = vi.fn().mockResolvedValue(completion("不应请求"));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();

    await expect(requestAiPanels({ text: "capture", mode: "word" }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not return or cache a cancelled response when the transport ignores cancellation", async () => {
    configureAi();
    let resolveResponse!: (value: ReturnType<typeof completion>) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveResponse = resolve; }))
      .mockResolvedValueOnce(completion("重试结果"));
    vi.stubGlobal("fetch", fetchMock);
    const request = { text: "capture", mode: "word", learning: "examples" } as const;
    const controller = new AbortController();
    const pending = requestAiPanels(request, controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    resolveResponse(completion("过期结果"));
    await rejection;

    await expect(requestAiPanels(request)).resolves.toMatchObject([{ body: "重试结果" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not repopulate a cleared cache from a response already in flight", async () => {
    configureAi();
    let resolveResponse!: (value: ReturnType<typeof completion>) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveResponse = resolve; }))
      .mockResolvedValueOnce(completion("新结果"));
    vi.stubGlobal("fetch", fetchMock);
    const request = { text: "capture", mode: "word" } as const;
    const pending = requestAiPanels(request);
    clearAiPanelCache();
    resolveResponse(completion("过期结果"));
    await pending;

    await expect(requestAiPanels(request)).resolves.toMatchObject([{ body: "新结果" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports the upstream status and message, and refuses to call an unconfigured provider", async () => {
    configureAi();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 401, statusText: "Unauthorized",
      text: async () => JSON.stringify({ error: { message: "Incorrect API key provided" } }),
    }));

    await expect(requestAiPanels({ text: "hello", mode: "text" })).rejects.toMatchObject({
      message: expect.stringContaining("401"),
    });
    await expect(requestAiPanels({ text: "hello", mode: "text" })).rejects.toSatisfy((error: unknown) => describeAiError(error).includes("Incorrect API key provided"));

    window.localStorage.clear();
    clearAiPanelCache();
    await expect(requestAiPanels({ text: "hello", mode: "text" })).rejects.toMatchObject({ kind: "unconfigured" });
  });
});

describe("AI connection test", () => {
  afterEach(() => vi.unstubAllGlobals());

  const credentials = { apiBaseUrl: "https://api.deepseek.com/v1", apiKey: "secret", model: "deepseek-chat" };

  it("reports a working endpoint with the model that answered", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }) }));

    const result = await testAiConnection(credentials);

    expect(result.ok).toBe(true);
    expect(result.message).toContain("deepseek-chat");
  });

  it("reports exactly what the endpoint answered when the key is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 401, statusText: "Unauthorized",
      text: async () => JSON.stringify({ error: { message: "Authentication Fails, Your api key is invalid" } }),
    }));

    const result = await testAiConnection({ ...credentials, apiKey: "wrong" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("401");
    expect(result.message).toContain("api key is invalid");
  });

  it("asks for the missing fields instead of calling a half-filled form", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await testAiConnection({ apiBaseUrl: "", apiKey: "secret", model: "deepseek-chat" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("尚未配置");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Link, MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppFrame } from "../../app/AppFrame";
import { QueryPage } from "./QueryPage";
import { listVocabulary } from "../vocabulary/vocabularyStore";
import { addHistory, listHistory } from "../history/historyStore";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../settings/settingsStore";
import { translateLocally } from "./localTranslationProvider";
import * as translationService from "./translationService";

vi.mock("./localTranslationProvider", () => ({ translateLocally: vi.fn() }));

const ecdictEntry = {
  word: "serendipity",
  phonetic: "serən'dipəti",
  definition: "n. the occurrence of events by chance in a happy way",
  translation: "n. 意外发现美好事物的运气",
  pos: "n:100",
  exchange: "s:serendipities",
};

describe("QueryPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(translateLocally).mockReset().mockResolvedValue({ translation: "本地译文", source: "en", target: "zh" });
    // 词典内容走批量查询接口，音标仍走 /api/local-dictionary。
    // 默认打桩对任何查询词都给同一条 ECDICT 条目，与迁移前的行为一致。
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("/api/dictionary-lookup")) {
        const words = (JSON.parse(String(init?.body ?? "{}")).words ?? []) as string[];
        const hits: Record<string, unknown> = {};
        for (const word of words) hits[word.toLowerCase()] = { ecdict: ecdictEntry };
        return { ok: true, json: async () => ({ hits }) };
      }
      // 音标字段一概不提供，与迁移前这些用例的打桩保持一致；音标链路另有专门用例覆盖。
      return { ok: true, json: async () => ({ entry: ecdictEntry }) };
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("navigates from individual English words in local sentence translations", async () => {
    vi.mocked(translateLocally).mockResolvedValueOnce({ translation: "The school is nearby.", source: "zh", target: "en" });
    render(<MemoryRouter initialEntries={["/query?q=学校在附近。"]}><QueryPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "查词 school" }));
    expect(await screen.findByRole("heading", { name: "school" })).toBeInTheDocument();
    expect(screen.getByLabelText("重新查询")).toHaveValue("school");
  });

  it("shows a Youdao phrase without word controls and records its real source", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ce: { word: [{ "return-phrase": { l: { i: "计算机" } }, trs: [{ tr: [{ l: { i: ["computer"], "#tran": "计算机" } }] }] }] } }) })));
    render(<MemoryRouter initialEntries={["/query?q=计算机"]}><QueryPage /></MemoryRouter>);
    await screen.findByRole("button", { name: "查词 computer" });
    expect(screen.getByTestId("provider-panel-local")).toHaveTextContent("词库解释");
    expect(screen.queryByRole("button", { name: "加入生词本" })).not.toBeInTheDocument();
    expect(listHistory()[0].source).toBe("有道词典");
    expect(translateLocally).not.toHaveBeenCalled();
  });

  it("shows a correction without replacing input, saves the corrected word and calls AI only for that word", async () => {
    saveSettings({ query: { aiEnabled: true } });
    const ai = vi.spyOn(translationService, "loadAiPanels").mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url === "/api/dictionary-suggest" ? { words: ["capture"] } : url === "/api/dictionary-lookup" ? { hits: { capture: { ecdict: { ...ecdictEntry, word: "capture", translation: "v. 捕获", pos: "v:100" } } } } : {} })));
    try {
      render(<MemoryRouter initialEntries={["/query?q=captuer"]}><QueryPage /></MemoryRouter>);
      expect(await screen.findByText(/拼写可能有误，已为你显示/)).toHaveTextContent("capture");
      expect(screen.getByLabelText("重新查询")).toHaveValue("captuer");
      expect(screen.getByTestId("dictionary-entry")).toHaveTextContent("捕获");
      await waitFor(() => expect(ai).toHaveBeenCalledOnce());
      expect(ai.mock.calls[0][0]).toBe("capture");
      fireEvent.click(screen.getByRole("button", { name: "加入生词本" }));
      expect(listVocabulary()[0]).toMatchObject({ word: "capture", meaning: "捕获" });
      fireEvent.click(within(screen.getByText(/拼写可能有误，已为你显示/)).getByRole("button", { name: "capture" }));
      expect(await screen.findByRole("heading", { name: "capture" })).toBeInTheDocument();
      expect(screen.getByLabelText("重新查询")).toHaveValue("capture");
    } finally { ai.mockRestore(); }
  });

  it("keeps editable input separate from the active result and handles repeated and external queries", async () => {
    const queries = vi.spyOn(translationService, "resolveQuery");
    try {
      render(<MemoryRouter initialEntries={["/query?q=cat"]}><QueryPage /><Link to="/query?q=break">external break</Link></MemoryRouter>);
      const input = screen.getByLabelText("重新查询");
      expect(input).toHaveValue("cat");
      fireEvent.change(input, { target: { value: "  capture  " } });
      expect(screen.getByRole("heading", { name: "cat" })).toBeInTheDocument();
      fireEvent.keyDown(input, { key: "Enter" });
      await screen.findByRole("heading", { name: "capture" });
      await screen.findByTestId("dictionary-entry");
      expect(input).toHaveValue("  capture  ");
      fireEvent.change(input, { target: { value: "captur" } });
      expect(screen.getByRole("heading", { name: "capture" })).toBeInTheDocument();
      expect(listHistory().map(entry => entry.query)).toEqual(["capture", "cat"]);
      fireEvent.change(input, { target: { value: "capture" } });
      const calls = queries.mock.calls.length;
      fireEvent.click(screen.getByRole("button", { name: /^查询$/ }));
      await waitFor(() => expect(queries).toHaveBeenCalledTimes(calls + 1));
      expect(listHistory().map(entry => entry.query)).toEqual(["capture", "cat"]);
      fireEvent.click(screen.getByRole("link", { name: "external break" }));
      expect(await screen.findByRole("heading", { name: "break" })).toBeInTheDocument();
      expect(input).toHaveValue("break");
    } finally { queries.mockRestore(); }
  });

  it("queries from history and visible example words through the same route", async () => {
    const queries = vi.spyOn(translationService, "resolveQuery").mockImplementation(async query => ({
      kind: "word", query, status: "success", britishPhonetic: "—", americanPhonetic: "—", source: "test", meaning: "释义", example: "",
      panels: [{ id: "ecdict", label: "词库解释", badge: "", title: "", body: "" }],
      entries: [{ word: query, source: "ECDICT", phonetic: "", britishPhonetic: "", americanPhonetic: "", partOfSpeech: "noun", meanings: [{ partOfSpeech: "noun", translations: ["释义"] }], meaning: "释义", definitions: [], definition: "", exchange: [], example: "", examples: [{ partOfSpeech: "", text: "He had been dogged by bad health all his life." }], collocations: ["good health"], wordForms: [] }],
    }));
    try {
      addHistory({ query: "break", kind: "word", source: "test" });
      render(<MemoryRouter initialEntries={["/query?q=dog"]}><QueryPage /></MemoryRouter>);
      await screen.findByTestId("dictionary-entry");
      fireEvent.click(screen.getByLabelText("重新查询"));
      const history = await screen.findByRole("dialog", { name: "最近查询" });
      fireEvent.click(within(history).getByRole("button", { name: "break" }));
      await screen.findByRole("heading", { name: "break" });
      expect(screen.getByLabelText("重新查询")).toHaveValue("break");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await screen.findByTestId("dictionary-entry");
      fireEvent.click(screen.getAllByRole("button", { name: "查词 health" })[0]);
      await screen.findByRole("heading", { name: "health" });
      expect(screen.getByLabelText("重新查询")).toHaveValue("health");
      expect(listHistory().map(entry => entry.query)).toEqual(["health", "break", "dog"]);
      await screen.findByTestId("dictionary-entry");
      fireEvent.click(screen.getByRole("button", { name: "查词 dogged" }));
      await screen.findByRole("heading", { name: "dogged" });
      expect(queries.mock.calls.map(([query]) => query)).toEqual(["dog", "break", "health", "dogged"]);
    } finally { queries.mockRestore(); }
  });

  it("renders online dictionary entries and saves their real source to vocabulary", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ec: { word: [{
      "return-phrase": { l: { i: "Tauri" } }, trs: [{ tr: [{ l: { i: ["adj. 金牛座的"] } }] }],
    }] } }) })));
    render(<MemoryRouter initialEntries={["/query?q=tauri"]}><QueryPage /></MemoryRouter>);
    const entry = await screen.findByTestId("dictionary-entry");
    expect(entry).toHaveTextContent("金牛座的");
    expect(screen.getByRole("button", { name: "收起词库解释" })).toBeInTheDocument();
    expect(screen.getByTestId("provider-panel-ecdict")).toHaveTextContent("有道词典");
    fireEvent.click(screen.getByRole("button", { name: "加入生词本" }));
    expect(listVocabulary()[0]).toMatchObject({ word: "tauri", meaning: "金牛座的", source: "有道词典" });
    expect(screen.getByRole("button", { name: "展开AI 翻译" })).toBeInTheDocument();
  });

  it.each([true, false])("shows an independent AI panel for Chinese lookup with online=%s", async online => {
    const connection = vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => {
      if (url.startsWith("/api/youdao-dictionary")) return { ce: { word: [{
        "return-phrase": { l: { i: "猫" } }, trs: [{ tr: [{ l: { i: [{ "#text": "cat" }], "#tran": "猫，猫科动物" } }] }],
      }] } };
      if (url === "/api/dictionary-reverse") return { hits: [{ word: "cat", source: "cedict", rank: 1000 }] };
      return { hits: { cat: { ecdict: { ...ecdictEntry, word: "cat", translation: "n. 猫", pos: "n" } } } };
    } })));
    try {
      render(<MemoryRouter initialEntries={["/query?q=猫"]}><QueryPage /></MemoryRouter>);
      await waitFor(() => expect(screen.getByTestId("provider-panel-ecdict")).toHaveTextContent("cat"));
      fireEvent.click(screen.getByRole("button", { name: "展开AI 翻译" }));
      expect(await screen.findByText(/尚未配置 AI 翻译接口/)).toBeInTheDocument();
      expect(screen.getByTestId("provider-panel-ecdict")).toHaveTextContent("cat");
      expect(screen.queryByRole("button", { name: "加入生词本" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "查词 cat" }));
      expect(await screen.findByRole("heading", { name: "cat", level: 2 })).toBeInTheDocument();
    } finally { connection.mockRestore(); }
  });

  it("uses the current query mode exactly once when automatic queries change type", async () => {
    saveSettings({ query: { aiEnabled: true } });
    const aiCalls = vi.spyOn(translationService, "loadAiPanels").mockResolvedValue([]);
    try {
      render(<MemoryRouter initialEntries={["/query?q=serendipity"]}><QueryPage /></MemoryRouter>);
      await screen.findByTestId("dictionary-entry");
      await waitFor(() => expect(aiCalls).toHaveBeenCalledOnce());
      fireEvent.change(screen.getByLabelText("重新查询"), { target: { value: "phase out" } });
      fireEvent.click(screen.getByRole("button", { name: /^查询$/ }));
      await screen.findByText("本地译文");
      expect(aiCalls.mock.calls.map(([query, options]) => [query, options?.mode])).toEqual([
        ["serendipity", "word"], ["phase out", "phrase"],
      ]);
    } finally {
      aiCalls.mockRestore();
    }
  });

  it("automatically opens AI without marking a successful dictionary lookup as unavailable", async () => {
    saveSettings({ query: { aiEnabled: true } });
    render(<MemoryRouter initialEntries={["/query?q=serendipity"]}><QueryPage /></MemoryRouter>);

    await screen.findByTestId("dictionary-entry");
    expect(await screen.findByText(/尚未配置 AI 翻译接口/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起AI 翻译" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("provider-panel-ecdict")).toHaveTextContent("意外发现美好事物的运气");
    expect(screen.queryByText("词库暂时不可用，请稍后重试。")).not.toBeInTheDocument();
  });

  it("shows an empty state when opened without a query", () => {
    render(
      <MemoryRouter initialEntries={["/query"]}>
        <QueryPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "开始一次新的查询" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "查询历史" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("query-results")).not.toBeInTheDocument();
    expect(listHistory()).toHaveLength(0);
  });

  it("restores the most recent query when opened without a query parameter", async () => {
    addHistory({ query: "任意中文查询", kind: "phrase", source: "AI 翻译接口" });

    render(
      <MemoryRouter initialEntries={["/query"]}>
        <QueryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "任意中文查询" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "开始一次新的查询" })).not.toBeInTheDocument();
  });

  it("renders ECDICT query results inside the app scroll container", async () => {
    render(
      <MemoryRouter initialEntries={["/query?q=serendipity"]}>
        <AppFrame>
          <QueryPage />
        </AppFrame>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("query-results")).toBeInTheDocument();
    expect(screen.getByTestId("query-results").closest("main")).toHaveAttribute(
      "data-scroll-container",
      "app-content",
    );
    expect(screen.queryByTestId("query-history")).not.toBeInTheDocument();
    expect(screen.queryByText("单词查询")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "英 —" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "美 —" })).toBeInTheDocument();
    expect(screen.getByTestId("provider-panel-ecdict")).toHaveTextContent("词库解释");
  });

  it("loads free sentence translation first and sends AI only after expansion", async () => {
    saveSettings({ translation: { ...DEFAULT_SETTINGS.translation, enabled: true, apiBaseUrl: "https://ai.example/v1", apiKey: "secret", model: "demo" } });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ cards: [
        { id: "ai-daily", title: "日常表达", body: "逐步淘汰" },
        { id: "ai-academic", title: "书面表达", body: "逐步取消" },
      ] }) } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter initialEntries={["/query?q=We%20will%20phase%20it%20out."]}>
        <QueryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("本地译文")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(listHistory()[0].source).toBe("本地翻译");
    expect(screen.getByTestId("provider-panel-local")).toHaveTextContent("本地翻译");
    expect(screen.queryByText("句子与段落翻译")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开AI 翻译" }));
    expect(await screen.findByText("逐步淘汰")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^provider-panel-/)).toHaveLength(2);
    expect(screen.getByTestId("provider-panel-ai")).toHaveTextContent("日常表达");
    expect(screen.getByTestId("provider-panel-ai")).toHaveTextContent("书面表达");
    expect(screen.getByRole("heading", { name: "日常表达" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "书面表达" })).toBeInTheDocument();
    expect(screen.queryByText("短语翻译")).not.toBeInTheDocument();
    expect(screen.queryByText("自动翻译")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("provider-panel-ai")).getByRole("button", { name: "收起AI 翻译" })).toBeInTheDocument();
    expect(screen.getByText("逐步取消")).toBeInTheDocument();
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe("/api/ai-translate");
  });

  it("shows local failures without sending a configured AI fallback", async () => {
    saveSettings({ translation: { ...DEFAULT_SETTINGS.translation, apiBaseUrl: "https://ai.example/v1", apiKey: "secret", model: "demo" } });
    vi.mocked(translateLocally).mockRejectedValueOnce(new Error("模型缺失"));
    const fetch = vi.mocked(globalThis.fetch);
    render(<MemoryRouter initialEntries={["/query?q=We%20will%20phase%20it%20out."]}><QueryPage /></MemoryRouter>);
    expect(await screen.findByText(/模型缺失/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps recording shared history without rendering a second history panel", async () => {
    render(
      <MemoryRouter initialEntries={["/query?q=phase%20out"]}>
        <QueryPage />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("query-history")).not.toBeInTheDocument();
    expect(listHistory()[0]).toMatchObject({ query: "phase out", kind: "phrase" });
  });

  it("does not write the previous translation into a new failed query's history", async () => {
    vi.mocked(translateLocally).mockResolvedValueOnce({ translation: "旧查询译文", source: "en", target: "zh" }).mockRejectedValueOnce(new Error("模型缺失"));
    render(<MemoryRouter initialEntries={["/query?q=phase%20out"]}><QueryPage /></MemoryRouter>);
    await screen.findByText("旧查询译文");
    fireEvent.change(screen.getByRole("textbox", { name: "重新查询" }), { target: { value: "look forward to" } });
    fireEvent.submit(screen.getByRole("form", { name: "翻译查询" }));
    await screen.findByText(/模型缺失/);
    expect(listHistory().find(entry => entry.query === "look forward to")?.preview).toBeUndefined();
    expect(listHistory().find(entry => entry.query === "phase out")?.preview).toBe("旧查询译文");
  });

  it("adds an ECDICT result to the shared vocabulary store", async () => {
    render(
      <MemoryRouter initialEntries={["/query?q=serendipity"]}>
        <QueryPage />
      </MemoryRouter>,
    );

    await screen.findByTestId("dictionary-entry");
    fireEvent.click(screen.getByRole("button", { name: "加入生词本" }));

    expect(screen.getByRole("button", { name: "已加入生词本" })).toBeInTheDocument();
    expect(listVocabulary()[0]).toMatchObject({ word: "serendipity", sourceType: "lookup", partOfSpeech: "noun", definition: expect.stringContaining("occurrence") });
    expect(listHistory()[0]).toMatchObject({ query: "serendipity", kind: "word" });
  });

  it("retains the inflected search while showing and saving its lemma", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes("dictionaryapi.dev")) return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.resolve({
        ok: true,
        json: async () => ({
          hits: { flower: { ecdict: {
            word: "flower",
            phonetic: "'flaʊə",
            definition: "n. the bloom of a plant",
            translation: "n. 花",
            pos: "n:100",
            exchange: "s:flowers",
          } } },
        }),
      });
    }));

    render(
      <MemoryRouter initialEntries={["/query?q=flowers"]}>
        <QueryPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "flowers", level: 2 })).toBeInTheDocument();
    expect(await screen.findByText("flower的复数形式")).toBeInTheDocument();
    expect(listHistory()[0]).toMatchObject({ query: "flowers", kind: "word" });
    fireEvent.click(screen.getByRole("button", { name: "加入生词本" }));
    expect(listVocabulary()[0]).toMatchObject({ word: "flower", sourceType: "lookup" });
  });

  it("restores the saved state after remounting", async () => {
    const first = render(
      <MemoryRouter initialEntries={["/query?q=serendipity"]}>
        <QueryPage />
      </MemoryRouter>,
    );
    await screen.findByTestId("dictionary-entry");
    fireEvent.click(screen.getByRole("button", { name: "加入生词本" }));
    first.unmount();

    render(
      <MemoryRouter initialEntries={["/query?q=serendipity"]}>
        <QueryPage />
      </MemoryRouter>,
    );

    await screen.findByTestId("dictionary-entry");
    expect(screen.getByRole("button", { name: "已加入生词本" })).toBeInTheDocument();
  });

  it("shows a loading state while the installed dictionary is resolving", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter initialEntries={["/query?q=serendipity"]}>
        <QueryPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("正在查询词库");
  });

  it("keeps ECDICT open and restores the independent AI panel", async () => {
    render(
      <MemoryRouter initialEntries={["/query?q=serendipity"]}>
        <QueryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "收起词库解释" })).toHaveAttribute("aria-expanded", "true");
    // The AI learning card is there but stays collapsed until it is expanded.
    expect(screen.getByTestId("provider-panel-ai")).toHaveTextContent("AI 翻译");
    expect(within(screen.getByTestId("provider-panel-ai")).getByRole("button")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "展开常见搭配" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "展开常见例句" })).not.toBeInTheDocument();
    expect(within(screen.getByTestId("provider-panel-ecdict")).getByTestId("dictionary-entry")).toBeInTheDocument();
  });

  it("keeps the existing British online audio while using Merriam-Webster audio for American pronunciation", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes("dictionaryapi.dev")) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ phonetics: [
            { text: "/ˌser-ən-ˈdi-pə-tē/", audio: "https://audio.example/serendipity-uk.mp3" },
            { text: "/ˌser-ən-ˈdipədē/", audio: "https://audio.example/serendipity-us.mp3" },
          ] }],
        });
      }
      if (String(input).includes("/api/ipa-pronunciation")) {
        return Promise.resolve({ ok: true, json: async () => ({ wikitext: "===Pronunciation===\n* {{IPA|en|/ˌser-ən-ˈdi-pə-tē/|a=RP}}\n* {{IPA|en|/ˌser-ən-ˈdipədē/|a=US}}" }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({
        hits: { serendipity: { ecdict: ecdictEntry } },
        oxfordPronunciation: {
          britishIpa: "/ˈserənˌdɪpəti/",
          americanIpa: "/ˈserənˌdɪpəti/",
        },
        merriamWebster: {
          pronunciation: "/ˈser-ən-ˈdi-pə-tē/",
          audioId: "serend01",
          audioUrl: "https://media.merriam-webster.com/audio/prons/en/us/mp3/s/serend01.mp3",
        },
      }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter initialEntries={["/query?q=serendipity"]}>
        <QueryPage />
      </MemoryRouter>,
    );

    await screen.findByTestId("dictionary-entry");
    const british = await screen.findByRole("button", { name: /英 \/.*\// });
    const american = screen.getByRole("button", { name: /美 \/.*\// });
    expect(british).toHaveAttribute("data-online-audio-url", "https://audio.example/serendipity-uk.mp3");
    expect(american).toHaveAttribute("data-online-audio-url", "https://media.merriam-webster.com/audio/prons/en/us/mp3/s/serend01.mp3");
    expect(british).toHaveTextContent("英 /ˈserənˌdɪpəti/");
    expect(american).toHaveTextContent("美 /ˈserənˌdɪpəti/");
    expect(british).toHaveAttribute("title", "免费英式发音");
    expect(american).toHaveAttribute("title", "韦氏美式发音");
  });

  it("falls back to existing American TTS when Merriam-Webster audio cannot play", async () => {
    vi.stubGlobal("Audio", vi.fn().mockImplementation(() => ({ play: vi.fn().mockRejectedValue(new Error("offline")) })));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        hits: { serendipity: { ecdict: ecdictEntry } },
        merriamWebster: {
          pronunciation: "/ˌser-ən-ˈdi-pə-tē/",
          audioId: "serend01",
          audioUrl: "https://media.merriam-webster.com/audio/prons/en/us/mp3/s/serend01.mp3",
        },
      }),
    }));

    render(
      <MemoryRouter initialEntries={["/query?q=serendipity"]}>
        <QueryPage />
      </MemoryRouter>,
    );

    await screen.findByTestId("dictionary-entry");
    fireEvent.click(screen.getByRole("button", { name: "美 —" }));

    await waitFor(() => expect(window.speechSynthesis.speak).toHaveBeenCalled());
    const utterance = vi.mocked(window.speechSynthesis.speak).mock.calls.at(-1)?.[0] as SpeechSynthesisUtterance;
    expect(utterance.lang).toBe("en-US");
  });

});

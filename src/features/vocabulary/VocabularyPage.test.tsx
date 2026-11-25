import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listVocabulary, saveVocabulary, updateVocabulary } from "./vocabularyStore";
import { VocabularyPage } from "./VocabularyPage";
import { serializeVocabularyBackup } from "./vocabularyBackup";

describe("VocabularyPage", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  function renderPage() {
    return render(<MemoryRouter><VocabularyPage /></MemoryRouter>);
  }

  function row(word: string) {
    const item = screen.getByRole("button", { name: `查看 ${word} 详情` }).closest(".vocabulary-item");
    if (!item) throw new Error(`找不到 ${word} 的词条行`);
    return within(item as HTMLElement);
  }

  function openMenu(name: string) {
    fireEvent.click(screen.getByRole("button", { name }));
  }

  it("counts the pending queue and shows one study pill per word", () => {
    saveVocabulary({ word: "resilient", meaning: "有韧性的", source: "阅读器", sourceType: "reading" });
    const mastered = saveVocabulary({ word: "serendipity", meaning: "机缘巧合", source: "本地词库", sourceType: "lookup" });
    updateVocabulary(mastered.id, { status: "mastered" });
    renderPage();

    expect(screen.getByText("待学习 1")).toBeInTheDocument();
    expect(row("resilient").getByText("待学习")).toBeInTheDocument();
    expect(row("serendipity").getByText("已掌握")).toBeInTheDocument();
  });

  it("shows the current word count beside every study-state filter", () => {
    saveVocabulary({ word: "articulate", meaning: "善于表达的", source: "本地词库", sourceType: "lookup" });
    saveVocabulary({ word: "resilient", meaning: "有韧性的", source: "阅读器", sourceType: "reading" });
    const mastered = saveVocabulary({ word: "cat", meaning: "猫", source: "本地词库", sourceType: "lookup" });
    updateVocabulary(mastered.id, { status: "mastered" });
    renderPage();

    const filters = screen.getByRole("group", { name: "按学习状态筛选" });
    expect(within(filters).getByRole("button", { name: "全部 3" })).toBeInTheDocument();
    expect(within(filters).getByRole("button", { name: "待学习 2" })).toBeInTheDocument();
    expect(within(filters).getByRole("button", { name: "学习中 0" })).toBeInTheDocument();
    expect(within(filters).getByRole("button", { name: "已掌握 1" })).toBeInTheDocument();
  });

  it("filters by study state from the chip row and sorts alphabetically from the toolbar menu", () => {
    saveVocabulary({ word: "articulate", meaning: "善于表达的", source: "本地词库", sourceType: "lookup" });
    saveVocabulary({ word: "resilient", meaning: "有韧性的", source: "阅读器", sourceType: "reading" });
    const mastered = saveVocabulary({ word: "cat", meaning: "猫", source: "本地词库", sourceType: "lookup" });
    updateVocabulary(mastered.id, { status: "mastered" });
    renderPage();

    openMenu("最近收藏");
    expect(screen.getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual(["最近收藏", "最早收藏", "单词 A–Z", "单词 Z–A"]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "单词 A–Z" }));
    expect(screen.getAllByRole("button", { name: /^查看 .* 详情$/ })[0]).toHaveAccessibleName("查看 articulate 详情");

    fireEvent.click(screen.getByRole("button", { name: "已掌握 1" }));
    expect(screen.getByRole("button", { name: "查看 cat 详情" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看 resilient 详情" })).not.toBeInTheDocument();
    expect(row("cat").getByText("已掌握")).toBeInTheDocument();
  });

  it("masks every Chinese meaning and reveals them one by one", () => {
    saveVocabulary({ word: "cat", meaning: "猫；恶妇", partOfSpeech: "noun · verb", source: "本地词库", sourceType: "lookup" });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "隐藏释义" }));

    expect(screen.queryByText("猫；恶妇")).not.toBeInTheDocument();
    expect(row("cat").getByRole("button", { name: "显示 cat 的中文释义" })).toBeInTheDocument();
    fireEvent.click(row("cat").getByRole("button", { name: "显示 cat 的中文释义" }));
    expect(screen.getAllByText("猫；恶妇").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "显示全部释义" })).toHaveAttribute("aria-pressed", "true");
  });

  it("removes a word and puts it back from the undo toast", () => {
    saveVocabulary({ word: "cat", meaning: "猫", source: "本地词库", sourceType: "lookup" });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "移出 cat" }));

    expect(listVocabulary()).toEqual([]);
    expect(screen.getByText("已将 cat 移出生词本")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));

    expect(listVocabulary().map((entry) => entry.word)).toEqual(["cat"]);
    expect(screen.getByRole("button", { name: "查看 cat 详情" })).toBeInTheDocument();
  });

  it("moves a word through the three study states from the detail panel", () => {
    saveVocabulary({ word: "cat", meaning: "猫", source: "本地词库", sourceType: "lookup" });
    renderPage();

    const detail = within(screen.getByTestId("vocabulary-detail"));
    fireEvent.click(detail.getByRole("button", { name: "学习中" }));
    expect(listVocabulary()[0].status).toBe("learning");

    fireEvent.click(detail.getByRole("button", { name: "已掌握" }));
    expect(listVocabulary()[0].status).toBe("mastered");
    expect(screen.getByText("待学习 0")).toBeInTheDocument();
  });

  it("imports a pasted JSON word list into the pending queue", () => {
    saveVocabulary({ word: "cat", meaning: "猫", source: "本地词库", sourceType: "lookup" });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "导入" }));
    fireEvent.change(screen.getByLabelText("粘贴内容"), {
      target: { value: JSON.stringify([{ word: "groggy", meaning: "昏昏沉沉的" }, { word: "cat", meaning: "猫" }]) },
    });

    expect(screen.getByText(/识别到 2 行：新增 1 个，重复跳过 1 个/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导入 1 个词" }));

    expect(screen.getByText(/导入完成：新增 1 个词/)).toBeInTheDocument();
    expect(listVocabulary().map((entry) => entry.word)).toEqual(["groggy", "cat"]);
    expect(listVocabulary()[0]).toMatchObject({ status: "pending", source: "导入", sourceType: "import", meaning: "昏昏沉沉的" });
    expect(screen.queryByLabelText("粘贴内容")).not.toBeInTheDocument();
  });

  it("exports the entire wordbook despite filters and restores its notes and status via import", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    const entry = saveVocabulary({ word: "cat", meaning: "猫", definition: "Original definition", partOfSpeech: "noun", source: "本地词库", sourceType: "lookup", britishPhonetic: "/kæt/" });
    updateVocabulary(entry.id, { status: "mastered", note: "保留这条笔记" });
    saveVocabulary({ word: "dog", meaning: "狗", source: "导入", sourceType: "import" });
    let exportedBlob!: Blob;
    const BaseURL = URL;
    vi.stubGlobal("URL", class extends BaseURL {
      static createObjectURL(blob: Blob) { exportedBlob = blob; return "blob:http://localhost/vocabulary-backup"; }
      static revokeObjectURL() {}
    });
    let filename = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
    const page = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "已掌握 1" }));
    fireEvent.change(screen.getByRole("textbox", { name: "搜索生词" }), { target: { value: "cat" } });
    expect(screen.queryByRole("button", { name: "查看 dog 详情" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "导出" }));

    expect(filename).toMatch(/^LanDict-生词本-\d{4}-\d{2}-\d{2}\.json$/);
    let raw = "";
    await act(async () => {
      raw = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsText(exportedBlob);
      });
    });
    expect(JSON.parse(raw).entries.map((item: { word: string }) => item.word)).toEqual(["dog", "cat"]);
    expect(screen.getByRole("status")).toHaveTextContent("2 个词");
    page.unmount();
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ entry: { word: "cat", phonetic: "new-ipa", definition: "Different definition", translation: "n. 不应覆盖备份的释义", pos: "n:100", exchange: "" }, oxfordPronunciation: { britishIpa: "/new-gb/", americanIpa: "/new-us/" } }),
    }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "导入生词" }));
    fireEvent.change(screen.getByLabelText("粘贴内容"), { target: { value: raw } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "导入 2 个词" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "查看 cat 详情" }));
    });

    expect(listVocabulary()).toHaveLength(2);
    expect(listVocabulary().find((item) => item.word === "cat")).toMatchObject({
      meaning: "猫", definition: "Original definition", partOfSpeech: "noun", note: "保留这条笔记", status: "mastered", source: "本地词库", sourceType: "lookup", britishPhonetic: "/kæt/", createdAt: entry.createdAt,
    });
  });

  it("reports a failed export while leaving the saved words untouched", async () => {
    saveVocabulary({ word: "cat", meaning: "猫", source: "导入", sourceType: "import" });
    const BaseURL = URL;
    vi.stubGlobal("URL", class extends BaseURL {
      static createObjectURL(): string { throw new Error("Download unavailable"); }
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "导出" }));
    expect(await screen.findByRole("status")).toHaveTextContent("导出失败");
    expect(listVocabulary()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "查看 cat 详情" })).toBeInTheDocument();
  });

  it("shows restored details instead of the removed word's cached dictionary content", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    saveVocabulary({ word: "cat", meaning: "猫", source: "导入", sourceType: "import", collocations: ["backup phrase"], examples: [{ partOfSpeech: "noun", text: "Backup example.", translation: "备份例句。" }] });
    const backup = serializeVocabularyBackup(listVocabulary());
    window.localStorage.clear();
    saveVocabulary({ word: "cat", meaning: "猫", source: "导入", sourceType: "import" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ oxford: { collocations: ["stale phrase"], examples: [{ partOfSpeech: "noun", text: "Stale example.", translation: "旧缓存例句。" }] } }) }));
    renderPage();
    await waitFor(() => expect(screen.getByText("stale phrase")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "移出 cat" }));
    fireEvent.click(screen.getByRole("button", { name: "导入生词" }));
    fireEvent.change(screen.getByLabelText("粘贴内容"), { target: { value: backup } });
    fireEvent.click(screen.getByRole("button", { name: "导入 1 个词" }));

    expect(screen.getByText("backup phrase")).toBeInTheDocument();
    expect(screen.getByText("Backup example.")).toBeInTheDocument();
    expect(screen.queryByText("stale phrase")).not.toBeInTheDocument();
    expect(screen.queryByText("Stale example.")).not.toBeInTheDocument();
  });

  it("explains that a chat export is not a word list", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "导入生词" }));
    fireEvent.change(screen.getByLabelText("粘贴内容"), {
      target: { value: JSON.stringify({ schemaVersion: 1, sessions: [{ messages: [{ role: "user", text: "hi" }] }] }) },
    });

    expect(screen.getByText(/这是语音聊天的记录文件，不是单词表/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入 0 个词" })).toBeDisabled();
  });

  it("starts word study from the wordbook instead of a placeholder", () => {
    saveVocabulary({ word: "cat", meaning: "猫", source: "本地词库", sourceType: "lookup" });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "开始背单词" }));

    expect(screen.queryByText("背单词页面还在设计里，这里先占个位置")).not.toBeInTheDocument();
  });

  it("uses a compact search field while keeping pronunciation in the detail panel", () => {
    saveVocabulary({ word: "serendipity", meaning: "意外的幸运", partOfSpeech: "noun", britishPhonetic: "/ˌserənˈdɪpəti/", americanPhonetic: "/ˌserənˈdɪpəti/", source: "本地词库", sourceType: "lookup" });
    renderPage();

    expect(screen.getByRole("textbox", { name: "搜索生词" })).toBeInTheDocument();

    const detail = within(screen.getByTestId("vocabulary-detail"));
    expect(detail.getByRole("button", { name: "播放 serendipity 英式发音" })).toHaveTextContent("英 /ˌserənˈdɪpəti/");
    expect(detail.getByRole("button", { name: "播放 serendipity 美式发音" })).toHaveTextContent("美 /ˌserənˈdɪpəti/");
  });

  it("searches every saved word and shows the empty result without dropping data", () => {
    saveVocabulary({ word: "articulate", meaning: "善于表达的", source: "Collins", sourceType: "lookup" });
    saveVocabulary({ word: "resilient", meaning: "有韧性的", source: "阅读器", sourceType: "reading" });
    renderPage();

    fireEvent.change(screen.getByRole("textbox", { name: "搜索生词" }), { target: { value: "善于表达" } });
    expect(screen.getByRole("button", { name: "查看 articulate 详情" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看 resilient 详情" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "搜索生词" }), { target: { value: "nomatch" } });
    expect(screen.getByText("没有匹配的单词")).toBeInTheDocument();
    expect(listVocabulary()).toHaveLength(2);

    fireEvent.change(screen.getByRole("textbox", { name: "搜索生词" }), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "查看 articulate 详情" })).toBeInTheDocument();
  });

  it("shows structured dictionary fields and keeps four collocations with one example per part of speech", () => {
    saveVocabulary({
      word: "connect",
      meaning: "连接；联合；联系",
      partOfSpeech: "noun · verb",
      collocations: ["connect A to B", "connect A and B", "connect sth", "connect sb", "closely connected"],
      examples: [
        { partOfSpeech: "noun", text: "The work is finished.", translation: "工作完成了。" },
        { partOfSpeech: "verb", text: "They work together.", translation: "他们一起工作。" },
        { partOfSpeech: "noun", text: "This is important work.", translation: "这是重要的工作。" },
      ],
      source: "本地词库",
      sourceType: "lookup",
    });
    renderPage();

    const detail = within(screen.getByTestId("vocabulary-detail"));
    expect(detail.getByText("noun")).toBeInTheDocument();
    expect(detail.getByText("verb")).toBeInTheDocument();
    expect(detail.getByText("connect A to B")).toBeInTheDocument();
    expect(detail.getByText("connect sb")).toBeInTheDocument();
    expect(detail.queryByText("closely connected")).not.toBeInTheDocument();
    expect(detail.getByText("The work is finished.")).toBeInTheDocument();
    expect(detail.getByText("They work together.")).toBeInTheDocument();
    expect(detail.queryByText("This is important work.")).not.toBeInTheDocument();
    expect(detail.getByText("本地词库")).toBeInTheDocument();
  });

  it("refreshes an old local-dictionary favorite with the current compatible meanings", async () => {
    saveVocabulary({
      word: "cat",
      meaning: "猫；恶妇；呕吐",
      partOfSpeech: "noun · verb",
      collocations: ["cat food"],
      examples: [{ partOfSpeech: "noun", text: "Old example.", translation: "旧例句。" }],
      source: "本地词库",
      sourceType: "lookup",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        entry: { word: "cat", phonetic: "kæt", definition: "n. a feline mammal", translation: "n. 猫, 恶妇\nvi. 呕吐", pos: "n:100", exchange: "s:cats" },
      }),
    }));
    renderPage();

    await waitFor(() => {
      const detail = screen.getByTestId("vocabulary-detail");
      expect(detail).toHaveTextContent("猫；恶妇");
      expect(detail).not.toHaveTextContent("呕吐");
    });
  });

  it("backfills placeholder phonetics so every saved word keeps matching British and American controls", async () => {
    saveVocabulary({
      word: "eat",
      meaning: "吃",
      phonetic: "—",
      britishPhonetic: "—",
      americanPhonetic: "—",
      source: "ECDICT",
      sourceType: "lookup",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ oxfordPronunciation: { britishIpa: "/iːt/", americanIpa: "/iːt/" } }),
    }));

    renderPage();

    await waitFor(() => {
      const detail = within(screen.getByTestId("vocabulary-detail"));
      expect(detail.getByRole("button", { name: "播放 eat 英式发音" })).toHaveTextContent("英 /iːt/");
      expect(detail.getByRole("button", { name: "播放 eat 美式发音" })).toHaveTextContent("美 /iːt/");
    });
  });

  it("offers query, reading and import actions when empty", () => {
    renderPage();

    expect(screen.getByRole("link", { name: "去查询单词" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "开始阅读" })).toHaveAttribute("href", "/reading");
    expect(screen.getByRole("button", { name: "导入生词" })).toBeInTheDocument();
    expect(screen.queryByTestId("vocabulary-detail")).not.toBeInTheDocument();
  });
});

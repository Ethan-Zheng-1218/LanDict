import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listLearningEvents } from "../learning/learningStore";
import { listVocabulary, saveVocabulary } from "../vocabulary/vocabularyStore";
import { ARTICLE_EXTRACTOR_VERSION, saveArticleDocument } from "./articleRepository";
import { ReadingArticlePage } from "./ReadingArticlePage";
import { saveSettings } from "../settings/settingsStore";
import { getReadingRecord, updateReadingProgress } from "./readingStore";
import * as translationService from "../translation/translationService";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

describe("ReadingArticlePage", () => {
  it("opens a full word query from the reader AI explanation", async () => {
    const ai = vi.spyOn(translationService, "loadAiPanels").mockResolvedValue([{ id: "ai-word", label: "AI 解释", badge: "", title: "", body: "Look around the school." }]);
    try {
      render(<MemoryRouter><ReadingArticlePage /><LocationProbe /></MemoryRouter>);
      fireEvent.click(screen.getAllByRole("button", { name: "查词 around" })[0]);
      const popover = await screen.findByTestId("reading-word-popover");
      const details = within(popover).getByText("AI 解释").closest("details")!;
      details.open = true;
      fireEvent(details, new Event("toggle"));
      fireEvent.click(await within(popover).findByRole("button", { name: "查词 school" }));
      expect(screen.getByTestId("location")).toHaveTextContent("/query");
    } finally { ai.mockRestore(); }
  });
  it("点击文章单词时按阅读口音自动朗读", async () => {
    saveSettings({ reading: { autoLookupWord: true, voiceAccent: "en-US" } });
    render(<MemoryRouter><ReadingArticlePage /></MemoryRouter>);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /查词 around/i }));
    });

    const utterance = vi.mocked(window.speechSynthesis.speak).mock.calls.at(-1)?.[0];
    expect(utterance?.text).toBe("around");
    expect(utterance?.lang).toBe("en-US");
  });

  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    const slot = document.createElement("aside");
    slot.id = "reading-outline-sidebar-slot";
    document.body.appendChild(slot);
  });

  afterEach(() => document.getElementById("reading-outline-sidebar-slot")?.remove());

  it("centres the complete reading tool cluster over the article column", () => {
    render(<MemoryRouter><ReadingArticlePage /></MemoryRouter>);
    const toolbar = screen.getByRole("toolbar", { name: "阅读工具" });
    const cluster = within(toolbar).getByTestId("reading-tool-cluster");
    expect(cluster).toHaveTextContent("返回字体朗读收藏");
    expect(within(cluster).getByTitle("阅读进度")).toBeInTheDocument();
    expect(screen.getByTestId("reader-side-panel")).toBeVisible();
    expect(screen.queryByRole("button", { name: /展开辅助面板|收起辅助面板/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("article-body").querySelector(".reading-meta-chip")).not.toBeInTheDocument();
  });

  it("turns every article word into a single-click lookup target and opens an anchored card", async () => {
    render(<MemoryRouter><ReadingArticlePage /></MemoryRouter>);
    fireEvent.click(screen.getAllByRole("button", { name: "查词 around" })[0]);
    const popover = await screen.findByTestId("reading-word-popover");
    expect(popover).toHaveTextContent("around");
    expect(within(popover).getByRole("button", { name: /加入生词本/ })).toBeInTheDocument();
    expect(screen.getByTestId("reader-side-panel")).toHaveAccessibleName("生词本");
  });

  it("makes words in the title and summary clickable too", () => {
    render(<MemoryRouter><ReadingArticlePage /></MemoryRouter>);

    expect(screen.getByRole("button", { name: "查词 Global" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查词 More" })).toBeInTheDocument();
  });

  it("keeps the clicked word visually active and offers an on-demand AI explanation", async () => {
    render(<MemoryRouter><ReadingArticlePage /></MemoryRouter>);
    const word = screen.getAllByRole("button", { name: "查词 around" })[0];

    fireEvent.click(word);

    expect(word).toHaveClass("is-active");
    const popover = screen.getByTestId("reading-word-popover");
    const aiExplanation = within(popover).getByText("AI 解释");
    expect(aiExplanation.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(aiExplanation);
    expect(await within(popover).findByText(/尚未配置 AI 翻译接口/)).toBeInTheDocument();
  });

  it("marks saved words and lists only words from this article in the permanent notebook", () => {
    saveVocabulary({ word: "governments", meaning: "政府；内阁", partOfSpeech: "noun", source: "测试", sourceType: "reading" });
    saveVocabulary({ word: "unrelated", meaning: "无关的", source: "测试", sourceType: "reading" });
    render(<MemoryRouter><ReadingArticlePage /></MemoryRouter>);
    expect(screen.getAllByRole("button", { name: "查词 Governments" })[0]).toHaveClass("is-saved");
    const notebook = screen.getByRole("complementary", { name: "生词本" });
    expect(notebook).toHaveTextContent("governments");
    expect(notebook).not.toHaveTextContent("unrelated");
  });

  it("adds a clicked word to the permanent article notebook", async () => {
    render(<MemoryRouter><ReadingArticlePage /></MemoryRouter>);
    fireEvent.click(screen.getAllByRole("button", { name: "查词 around" })[0]);
    fireEvent.click(within(screen.getByTestId("reading-word-popover")).getByRole("button", { name: /加入生词本/ }));
    await waitFor(() => expect(listVocabulary().map((entry) => entry.word)).toContain("around"));
    expect(screen.getByRole("complementary", { name: "生词本" })).toHaveTextContent("around");
  });

  it("keeps native text selection free of the old annotation toolbar", () => {
    render(<MemoryRouter><ReadingArticlePage /></MemoryRouter>);
    const body = screen.getByTestId("article-body");
    const range = document.createRange();
    range.selectNodeContents(body.querySelector("p")!);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.mouseUp(body);
    expect(screen.queryByTestId("selection-toolbar")).not.toBeInTheDocument();
  });

  it("renders a requested article and keeps its readable text intact", () => {
    saveArticleDocument({
      id: "bbc-custom", source: "bbc", title: "BBC Custom Title", summary: "BBC summary",
      originalUrl: "https://www.bbc.com/news/articles/custom", publishedAt: "2026-10-04T08:00:00.000Z",
      category: "World", downloaded: true, extractorVersion: ARTICLE_EXTRACTOR_VERSION,
      blocks: [{ id: "intro", type: "paragraph", text: "BBC custom paragraph." }],
    });
    render(<MemoryRouter initialEntries={["/reading/article?id=bbc-custom"]}><ReadingArticlePage /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "BBC Custom Title" })).toBeInTheDocument();
    expect(screen.getByTestId("article-body")).toHaveTextContent("BBC custom paragraph.");
    expect(screen.getByText("BBC News · World")).toBeInTheDocument();
  });

  it("shows an extracted author in article metadata", () => {
    saveArticleDocument({
      id: "voa-author", source: "voa", title: "A VOA story", summary: "A clean summary.",
      author: "Andrey Nazarbekian · Alex Grigoryev", originalUrl: "https://www.voanews.com/a/story/8208083.html",
      publishedAt: "2026-10-05T08:00:00.000Z", category: "VOA News", downloaded: true,
      extractorVersion: ARTICLE_EXTRACTOR_VERSION, blocks: [{ id: "paragraph-1", type: "paragraph", text: "The real story body." }],
    });
    render(<MemoryRouter initialEntries={["/reading/article?id=voa-author"]}><ReadingArticlePage /></MemoryRouter>);
    expect(screen.getByText("By Andrey Nazarbekian · Alex Grigoryev")).toBeInTheDocument();
    expect(screen.getByTestId("article-body")).toHaveTextContent("The real story body.");
  });

  it("returns to the reading home page", async () => {
    render(<MemoryRouter initialEntries={["/reading/article"]}><ReadingArticlePage /><LocationProbe /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "返回阅读列表" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/reading"));
  });

  it("restores an exact resume position before rounded progress", async () => {
    updateReadingProgress("global-push-clean-energy", 40);
    render(<MemoryRouter initialEntries={[{ pathname: "/reading/article", state: { readingScrollTop: 237 } }]}><ReadingArticlePage /></MemoryRouter>);
    const scroll = screen.getByTestId("article-scroll");
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 500 });
    await waitFor(() => expect(scroll.scrollTop).toBe(237));
  });

  it("persists scroll progress and creates the first reading event", () => {
    render(<MemoryRouter><ReadingArticlePage /></MemoryRouter>);
    const scroll = screen.getByTestId("article-scroll");
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 500 });
    Object.defineProperty(scroll, "scrollTop", { configurable: true, value: 250, writable: true });
    fireEvent.scroll(scroll);
    expect(getReadingRecord("global-push-clean-energy")).toMatchObject({ progress: 50 });
    expect(listLearningEvents()).toEqual(expect.arrayContaining([expect.objectContaining({ type: "reading" })]));
  });

  it("cycles font size and keeps the notebook visible", () => {
    render(<MemoryRouter><ReadingArticlePage /></MemoryRouter>);
    const body = screen.getByTestId("article-body");
    fireEvent.click(screen.getByRole("button", { name: "切换字号" }));
    expect(body).toHaveStyle({ fontSize: "19px" });
    expect(screen.getByRole("complementary", { name: "生词本" })).toBeVisible();
  });

  it("reads the article and resets the toolbar state when speech ends", () => {
    render(<MemoryRouter><ReadingArticlePage /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "听读" })).not.toHaveClass("active");
    fireEvent.click(screen.getByRole("button", { name: "听读" }));
    const utterance = vi.mocked(window.speechSynthesis.speak).mock.calls[0]?.[0] as SpeechSynthesisUtterance;
    expect(utterance.text).toContain("Governments around the world are ramping up");
    expect(utterance.text).not.toContain("Daniel Carter");
    act(() => utterance.onboundary?.({ charIndex: utterance.text.indexOf("Governments around the world") } as SpeechSynthesisEvent));
    expect(screen.getByTestId("article-body").querySelector(".reading-current-paragraph")).toBeInTheDocument();
    act(() => utterance.onend?.(new Event("end") as SpeechSynthesisEvent));
    expect(screen.getByRole("button", { name: "听读" })).toBeInTheDocument();
  });
});

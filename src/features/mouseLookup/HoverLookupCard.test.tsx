import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HoverLookupCard } from "./HoverLookupCard";
import { resolveQuery } from "../translation/translationService";
import { requestAiPanels } from "../translation/aiTranslationProvider";
import { fetchWordPronunciation } from "../translation/pronunciationService";
import { listVocabulary, saveVocabulary } from "../vocabulary/vocabularyStore";

vi.mock("../translation/translationService", () => ({ resolveQuery: vi.fn() }));
vi.mock("../translation/aiTranslationProvider", () => ({ requestAiPanels: vi.fn(), describeAiError: (error: Error) => error.message }));
vi.mock("../translation/pronunciationService", () => ({ fetchWordPronunciation: vi.fn() }));

/** 没有任何录音时：两边都落到系统语音。 */
const noRecording = {
  british: { ipa: "", ipaSource: "fallback", audioSource: "system-tts" },
  american: { ipa: "", ipaSource: "fallback", audioSource: "system-tts" },
} as const;

beforeEach(() => {
  window.localStorage.clear();
  vi.resetAllMocks();
  vi.mocked(fetchWordPronunciation).mockResolvedValue(noRecording);
});
afterEach(() => vi.unstubAllGlobals());
const wordResult = (query: string, meaning: string) => ({ kind: "word" as const, query, meaning, status: "success" as const, entries: [], panels: [], britishPhonetic: "bæŋk", americanPhonetic: "", example: "", source: "本地词库" });

it("keeps the target width through dictionary and AI updates and ignores height-only resizes", async () => {
  let finishLookup!: (value: ReturnType<typeof wordResult>) => void;
  vi.mocked(resolveQuery).mockReturnValue(new Promise(resolve => { finishLookup = resolve; }));
  vi.mocked(requestAiPanels).mockResolvedValue([]);
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
  const flushFrames = async () => { await act(async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); }); };
  let glyphWidth = 180;
  const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { width: this.hasAttribute("data-word-measure") ? glyphWidth : 300, height: 200, x: 0, y: 0, top: 0, left: 0, bottom: 200, right: 300, toJSON: () => ({}) };
  });
  try {
    const resize = vi.fn();
    render(<HoverLookupCard sample={{ id: 1, word: "bank", context: "He sat on the bank.", source: "uia" }} onResize={resize} />);
    await flushFrames();
    expect(resize.mock.calls.at(-1)?.[0]).toBe(300);
    glyphWidth = 260; // Simulate later font metrics while the same target remains open.
    await act(async () => finishLookup(wordResult("bank", "银行；河岸")));
    await flushFrames();
    fireEvent.click(screen.getByRole("button", { name: "展开AI解释" }));
    await act(async () => {});
    await flushFrames();
    expect(resize.mock.calls.length).toBeGreaterThan(1);
    expect(resize.mock.calls.every(([width]) => width === 300)).toBe(true);
    const count = resize.mock.calls.length;
    fireEvent(window, new Event("resize")); // Native height changes must not feed back into sizing.
    await flushFrames();
    expect(resize).toHaveBeenCalledTimes(count);
  } finally { bounds.mockRestore(); }
});

it("toggles the displayed word in the local notebook", async () => {
  vi.mocked(resolveQuery).mockResolvedValue({ ...wordResult("bank", "银行；河岸"), britishPhonetic: "bæŋk" });
  render(<HoverLookupCard sample={{ id: 1, word: "Bank", context: "He sat on the bank.", source: "uia" }} />);
  await screen.findByText("银行；河岸");
  fireEvent.click(screen.getByRole("button", { name: "收藏到本地生词本" }));
  expect(screen.getByRole("button", { name: "取消收藏" })).toBeEnabled();
  expect(listVocabulary()).toEqual([expect.objectContaining({ word: "bank", meaning: "银行；河岸", britishPhonetic: "bæŋk", example: "He sat on the bank.", source: "鼠标取词", status: "pending" })]);
  fireEvent.click(screen.getByRole("button", { name: "取消收藏" }));
  expect(screen.getByRole("button", { name: "收藏到本地生词本" })).toBeEnabled();
  expect(listVocabulary()).toEqual([]);
});

it("recognizes an existing favorite without overwriting its learning status", async () => {
  saveVocabulary({ word: "bank", meaning: "银行", source: "阅读", sourceType: "reading", status: "mastered" });
  vi.mocked(resolveQuery).mockResolvedValue(wordResult("bank", "银行；河岸"));
  render(<HoverLookupCard sample={{ id: 1, word: "Bank", context: "", source: "uia" }} />);
  await screen.findByText("银行；河岸");
  expect(screen.getByRole("button", { name: "取消收藏" })).toBeEnabled();
  expect(listVocabulary()).toHaveLength(1);
  expect(listVocabulary()[0].status).toBe("mastered");
});

it("shows the dictionary while contextual AI is still loading", async () => {
  vi.mocked(resolveQuery).mockResolvedValue(wordResult("bank", "银行；河岸"));
  vi.mocked(requestAiPanels).mockReturnValue(new Promise(() => {}));
  render(<HoverLookupCard sample={{ id: 1, word: "bank", context: "He sat on the bank.", source: "uia" }} />);
  expect(await screen.findByText("银行；河岸")).toBeInTheDocument();
  expect(requestAiPanels).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "展开AI解释" }));
  expect(screen.getByText("正在解释当前句子…")).toBeInTheDocument();
});

it("does not invent a contextual meaning without a sentence", async () => {
  vi.mocked(resolveQuery).mockResolvedValue(wordResult("bank", "银行；河岸"));
  render(<HoverLookupCard sample={{ id: 1, word: "bank", context: "", source: "ocr" }} />);
  expect(await screen.findByText("银行；河岸")).toBeInTheDocument();
  expect(screen.getByText("未获取到当前句子")).toBeInTheDocument();
  expect(requestAiPanels).not.toHaveBeenCalled();
});

it("keeps a newer word when an earlier lookup resolves late", async () => {
  let finishOld!: (value: ReturnType<typeof wordResult>) => void;
  vi.mocked(resolveQuery).mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }))
    .mockResolvedValueOnce(wordResult("cat", "猫"));
  const view = render(<HoverLookupCard sample={{ id: 1, word: "bank", context: "", source: "uia" }} />);
  view.rerender(<HoverLookupCard sample={{ id: 2, word: "cat", context: "", source: "uia" }} />);
  expect(await screen.findByText("猫")).toBeInTheDocument();
  await act(async () => finishOld(wordResult("bank", "银行")));
  expect(screen.queryByText("银行")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "cat" })).toBeInTheDocument();
});

it("preserves the dictionary if AI fails", async () => {
  vi.mocked(resolveQuery).mockResolvedValue(wordResult("bank", "银行；河岸"));
  vi.mocked(requestAiPanels).mockRejectedValue(new Error("尚未配置 AI 翻译接口"));
  render(<HoverLookupCard sample={{ id: 1, word: "bank", context: "He sat on the bank.", source: "uia" }} />);
  fireEvent.click(screen.getByRole("button", { name: "展开AI解释" }));
  expect(await screen.findByText("尚未配置 AI 翻译接口")).toBeInTheDocument();
  expect(screen.getByText("银行；河岸")).toBeInTheDocument();
});

it("copies the word and explanations and exposes a close action", async () => {
  vi.mocked(resolveQuery).mockResolvedValue(wordResult("bank", "银行；河岸"));
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const close = vi.fn();
  render(<HoverLookupCard sample={{ id: 1, word: "bank", context: "", source: "uia" }} onClose={close} />);
  await screen.findByText("银行；河岸");
  fireEvent.click(screen.getByRole("button", { name: "复制内容" }));
  expect(await screen.findByText("已复制")).toBeInTheDocument();
  expect(writeText).toHaveBeenCalledWith("bank\n\n中文释义\n银行；河岸\n\nAI 语境义\n未获取到当前句子");
  fireEvent.click(screen.getByRole("button", { name: "关闭取词窗口" }));
  expect(close).toHaveBeenCalledOnce();
});

it("pronounces the displayed word in British English when no online recording is available", async () => {
  vi.mocked(resolveQuery).mockResolvedValue(wordResult("bank", "银行；河岸"));
  render(<HoverLookupCard sample={{ id: 1, word: "bank", context: "", source: "uia" }} />);
  await screen.findByText("银行；河岸");
  fireEvent.click(screen.getByRole("button", { name: "英式发音" }));
  expect(window.speechSynthesis.speak).toHaveBeenCalledWith(expect.objectContaining({ text: "bank", lang: "en-GB" }));
});

it("plays the recording the shared pronunciation chain provides", async () => {
  vi.mocked(resolveQuery).mockResolvedValue(wordResult("bank", "银行；河岸"));
  vi.mocked(fetchWordPronunciation).mockResolvedValue({
    british: { ipa: "/bæŋk/", ipaSource: "oxford", audioUrl: "https://dict.youdao.com/dictvoice?audio=bank&type=1", audioSource: "youdao" },
    american: { ipa: "/bæŋk/", ipaSource: "oxford", audioSource: "system-tts" },
  });
  const played: string[] = [];
  vi.stubGlobal("Audio", vi.fn().mockImplementation((url: string) => ({
    play: vi.fn().mockImplementation(() => { played.push(url); return Promise.resolve(); }),
    pause: vi.fn(),
  })));
  render(<HoverLookupCard sample={{ id: 1, word: "bank", context: "", source: "uia" }} />);
  await screen.findByText("银行；河岸");
  fireEvent.click(screen.getByRole("button", { name: "英式发音" }));
  expect(played).toEqual(["https://dict.youdao.com/dictvoice?audio=bank&type=1"]);
  expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
});

it("activates the window only when the user presses inside the card", async () => {
  vi.mocked(resolveQuery).mockResolvedValue(wordResult("bank", "银行；河岸"));
  const activate = vi.fn();
  render(<HoverLookupCard sample={{ id: 1, word: "bank", context: "", source: "uia" }} onActivate={activate} />);
  await screen.findByText("银行；河岸");
  expect(activate).not.toHaveBeenCalled();
  fireEvent.pointerDown(screen.getByRole("button", { name: "英式发音" }));
  expect(activate).toHaveBeenCalledOnce();
});

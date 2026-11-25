import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OptionalAiPanel } from "./OptionalAiPanel";
import { DEFAULT_SETTINGS, saveSettings } from "../settings/settingsStore";
import { clearAiPanelCache } from "./aiTranslationProvider";
import * as service from "./translationService";

beforeEach(() => {
  window.localStorage.clear(); clearAiPanelCache();
  saveSettings({ translation: { ...DEFAULT_SETTINGS.translation, apiBaseUrl: "https://ai.example/v1", apiKey: "secret", model: "demo" } });
});
afterEach(() => vi.unstubAllGlobals());

it("loads the chosen word learning category and makes its English text interactive", async () => {
  const load = vi.spyOn(service, "loadAiPanels").mockImplementation(async (_query, options) => [{ id: "ai-learning", label: "AI 翻译", badge: "", title: "", body: options?.learning === "derivatives" ? "1. creative · adj. 有创造力的\nShe is creative." : "1. 创造\nWe create stories." }]);
  const lookup = vi.fn();
  try {
    render(<OptionalAiPanel query="create" mode="word" onLookup={lookup} />);
    fireEvent.click(screen.getByRole("button", { name: "展开AI 翻译" }));
    await screen.findByRole("button", { name: "查词 stories" });
    expect(load.mock.calls[0][1]).toMatchObject({ learning: "examples" });
    expect(screen.getAllByRole("tab")).toHaveLength(5);
    fireEvent.click(screen.getByRole("tab", { name: "派生词" }));
    await screen.findByRole("heading", { name: /creative/ });
    expect(load.mock.calls.at(-1)?.[1]).toMatchObject({ learning: "derivatives" });
    fireEvent.click(screen.getAllByRole("button", { name: "查词 creative" })[0]);
    expect(lookup).toHaveBeenCalledWith("creative");
    fireEvent.click(screen.getByRole("tab", { name: "例句" }));
    await screen.findByRole("button", { name: "查词 stories" });
    expect(load).toHaveBeenCalledTimes(2);
  } finally { load.mockRestore(); }
});

it("keeps sentence translation clickable without extra guidance", async () => {
  const load = vi.spyOn(service, "loadAiPanels").mockResolvedValue([{ id: "ai-english", label: "AI 翻译", badge: "", title: "英文翻译", body: "The school is nearby." }]);
  const lookup = vi.fn();
  try {
    render(<OptionalAiPanel query="学校在附近。" mode="text" onLookup={lookup} />);
    fireEvent.click(screen.getByRole("button", { name: "展开AI 翻译" }));
    fireEvent.click(await screen.findByRole("button", { name: "查词 school" }));
    expect(lookup).toHaveBeenCalledWith("school");
    expect(screen.queryByRole("tab", { name: "词根" })).not.toBeInTheDocument();
    expect(screen.queryByText(/点击.*英文单词/)).not.toBeInTheDocument();
  } finally { load.mockRestore(); }
});

it("does not display a late learning category response after switching categories", async () => {
  let finish!: (panels: service.QueryPanel[]) => void;
  const load = vi.spyOn(service, "loadAiPanels").mockImplementation(async (_query, options) => options?.learning === "roots"
    ? new Promise(resolve => { finish = resolve; })
    : [{ id: "ai-learning", label: "AI 翻译", badge: "", title: "", body: options?.learning === "synonyms" ? "替代词说明" : "例句内容" }]);
  try {
    render(<OptionalAiPanel query="create" mode="word" />);
    fireEvent.click(screen.getByRole("button", { name: "展开AI 翻译" }));
    await screen.findByText("例句内容");
    fireEvent.click(screen.getByRole("tab", { name: "词根" }));
    fireEvent.click(screen.getByRole("tab", { name: "近义词" }));
    await screen.findByText("替代词说明");
    await act(async () => finish([{ id: "old", label: "AI 翻译", badge: "", title: "", body: "过期词根" }]));
    expect(screen.queryByText("过期词根")).not.toBeInTheDocument();
  } finally { load.mockRestore(); }
});

function mockAi() {
  const fetch = vi.fn(async () => ({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: "自动译文" } }] }) }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

it("retries a failed category and supports keyboard switching", async () => {
  const load = vi.spyOn(service, "loadAiPanels")
    .mockResolvedValueOnce([{ id: "ai-error", label: "AI 翻译", badge: "", title: "", body: "暂时失败" }])
    .mockResolvedValue([{ id: "ai-learning-derivatives", label: "AI 翻译", badge: "", title: "", body: "1. creative\n有创造力的" }]);
  try {
    render(<OptionalAiPanel query="create" mode="word" />);
    fireEvent.click(screen.getByRole("button", { name: "展开AI 翻译" }));
    fireEvent.click(await screen.findByRole("button", { name: "重试AI翻译" }));
    await screen.findByRole("heading", { name: "1. creative" });
    fireEvent.keyDown(screen.getByRole("tab", { name: "例句" }), { key: "End" });
    await waitFor(() => expect(screen.getByRole("tab", { name: "派生词" })).toHaveAttribute("aria-selected", "true"));
    expect(load.mock.calls.at(-1)?.[1]?.learning).toBe("derivatives");
  } finally { load.mockRestore(); }
});

it("resets word learning when an automatic query changes to Chinese text", async () => {
  saveSettings({ query: { aiEnabled: true } });
  const load = vi.spyOn(service, "loadAiPanels").mockResolvedValue([{ id: "ai-learning", label: "AI 翻译", badge: "", title: "", body: "内容" }]);
  try {
    const view = render(<OptionalAiPanel query="create" mode="word" />);
    await screen.findByText("内容");
    fireEvent.click(screen.getByRole("tab", { name: "派生词" }));
    await screen.findByText("内容");
    view.rerender(<OptionalAiPanel query="学校在附近。" mode="text" />);
    await waitFor(() => expect(load.mock.calls.at(-1)?.[0]).toBe("学校在附近。"));
    expect(load.mock.calls.at(-1)?.[1]?.learning).toBeUndefined();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  } finally { load.mockRestore(); }
});

it("invalidates category results when the AI configuration changes", async () => {
  saveSettings({ query: { aiEnabled: true } });
  const load = vi.spyOn(service, "loadAiPanels").mockResolvedValue([{ id: "ai-learning", label: "AI 翻译", badge: "", title: "", body: "新内容" }]);
  try {
    render(<OptionalAiPanel query="create" mode="word" />);
    await screen.findByText("新内容");
    const oldSignal = load.mock.calls[0][2];
    act(() => { saveSettings({ translation: { ...DEFAULT_SETTINGS.translation, apiBaseUrl: "https://new.example/v1", apiKey: "new-key", model: "new-model" } }); });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(oldSignal?.aborted).toBe(true);
  } finally { load.mockRestore(); }
});

it.each(["word", "phrase", "text"] as const)("automatically opens and translates a %s query when enabled", async mode => {
  saveSettings({ query: { aiEnabled: true } });
  const fetch = mockAi();
  render(<OptionalAiPanel query="example" mode={mode} />);
  expect(await screen.findByText("自动译文")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "收起AI 翻译" })).toHaveAttribute("aria-expanded", "true");
  expect(fetch).toHaveBeenCalledOnce();
  expect(screen.queryByText("可选 · 可能产生接口费用")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "复制" })).not.toBeInTheDocument();
});

it("applies the automatic AI switch immediately and leaves later queries manual when disabled", async () => {
  const fetch = mockAi();
  const view = render(<OptionalAiPanel query="first" mode="word" />);
  expect(fetch).not.toHaveBeenCalled();
  act(() => { saveSettings({ query: { aiEnabled: true } }); });
  expect(await screen.findByText("自动译文")).toBeInTheDocument();
  act(() => { saveSettings({ appearance: { theme: "lime" } }); });
  expect(fetch).toHaveBeenCalledOnce();
  view.rerender(<OptionalAiPanel query="second" mode="word" />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  act(() => { saveSettings({ query: { aiEnabled: false } }); });
  view.rerender(<OptionalAiPanel query="third" mode="word" />);
  expect(screen.getByRole("button", { name: "展开AI 翻译" })).toHaveAttribute("aria-expanded", "false");
  expect(fetch).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "展开AI 翻译" }));
  expect(await screen.findByText("自动译文")).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("cancels the previous automatic query and does not show its late translation", async () => {
  saveSettings({ query: { aiEnabled: true } });
  let finishFirst!: (value: unknown) => void;
  const response = (text: string) => ({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: text } }] }) });
  const fetch = vi.fn()
    .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
    .mockResolvedValue(response("新译文"));
  vi.stubGlobal("fetch", fetch);
  const view = render(<OptionalAiPanel query="first" mode="word" />);
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  const signal = fetch.mock.calls[0][1].signal as AbortSignal;
  view.rerender(<OptionalAiPanel query="second" mode="word" />);
  expect(await screen.findByText("新译文")).toBeInTheDocument();
  expect(signal.aborted).toBe(true);
  await act(async () => { finishFirst(response("旧译文")); });
  expect(screen.queryByText("旧译文")).not.toBeInTheDocument();
});

it("never sends configured AI until the user expands the card", async () => {
  const fetch = vi.fn(async () => ({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ cards: [{ id: "ai-daily", body: "日常译文" }, { id: "ai-academic", body: "书面译文" }] }) } }] }) }));
  vi.stubGlobal("fetch", fetch);
  render(<OptionalAiPanel query="phase out" mode="phrase" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "展开AI 翻译" })).toHaveAttribute("aria-expanded", "false"));
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "展开AI 翻译" }));
  expect(await screen.findByText("日常译文")).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "收起AI 翻译" }));
  fireEvent.click(screen.getByRole("button", { name: "展开AI 翻译" }));
  expect(fetch).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});

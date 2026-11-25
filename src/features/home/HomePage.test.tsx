import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";

import { addHistory, listHistory } from "../history/historyStore";
import { HomePage } from "./HomePage";
import * as translationService from "../translation/translationService";
import * as previewApi from "../translation/definitionPreview";
import * as completionApi from "../translation/inputCompletion";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

describe("HomePage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T12:00:00+08:00"));
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("renders the home title, search entry point, and low-priority signature", () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(screen.getByRole("textbox", { name: "输入需要查询的内容" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "输入需要查询的内容" })).toHaveAttribute("autocomplete", "off");
    expect(screen.getByRole("heading", { name: "查询记录" })).toBeInTheDocument();
    expect(screen.queryByText("TODAY'S ENGLISH")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "从一个单词，开始今天的学习" })).toBeInTheDocument();
    expect(screen.getByText("“The limits of my language mean the limits of my world.”")).toBeInTheDocument();
    expect(
      screen.getByText("语言的边界，就是我世界的边界。—— 路德维希·维特根斯坦"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看历史记录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "清除记录" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "近期英文热点" })).not.toBeInTheDocument();
  });

  it("shows the same local preview and completion on home without recording unfinished input", async () => {
    vi.spyOn(previewApi, "getDefinitionPreview").mockImplementation(async word => word === "cat" ? "n. 猫" : "");
    vi.spyOn(completionApi, "getInputCompletion").mockImplementation(async word => word === "CAPT" ? "CAPTURE" : "");
    render(<MemoryRouter><HomePage /><LocationProbe /></MemoryRouter>);
    const input = screen.getByRole("textbox", { name: "输入需要查询的内容" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "cat" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(180); });
    expect(screen.getByTestId("definition-preview")).toHaveTextContent("n. 猫");
    fireEvent.change(input, { target: { value: "CAPT" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(180); });
    expect(screen.getByTestId("word-completion")).toHaveTextContent("CAPTURE");
    expect(listHistory()).toEqual([]);
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input).toHaveValue("CAPTURE");
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByTestId("location")).toHaveTextContent("/query?q=CAPTURE");
  });

  it("keeps available history in one vertical list without date labels", () => {
    vi.setSystemTime(new Date("2026-09-28T09:00:00+08:00"));
    addHistory({ query: "older query", kind: "phrase", source: "AI 翻译接口" });
    vi.setSystemTime(new Date("2026-10-02T09:00:00+08:00"));
    addHistory({ query: "yesterday one", kind: "phrase", source: "AI 翻译接口" });
    addHistory({ query: "yesterday two", kind: "phrase", source: "AI 翻译接口" });
    vi.setSystemTime(new Date("2026-10-03T12:00:00+08:00"));
    ["today one", "today two", "today three", "today four"].forEach((query) => {
      addHistory({ query, kind: "phrase", source: "AI 翻译接口" });
    });

    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(screen.queryByText("今天")).not.toBeInTheDocument();
    expect(screen.queryByText("昨天")).not.toBeInTheDocument();
    expect(screen.queryByText("之前")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^重新查询：/ })).toHaveLength(7);
    expect(screen.getByRole("button", { name: "重新查询：older query" })).toBeInTheDocument();
  });

  it("fits complete history rows to the window and shows an overflow marker only when needed", () => {
    let availableHeight = 350;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const height = this.classList.contains("home-history-area") ? availableHeight : this.tagName === "LI" ? 42 : 0;
      const top = this.classList.contains("home-history-list") ? 100 : 0;
      return { x: 0, y: top, top, bottom: top + height, left: 0, right: 900, width: 900, height, toJSON: () => ({}) };
    });
    Array.from({ length: 12 }, (_, index) => addHistory({ query: `query ${index}`, kind: "phrase", source: "LanDict" }));
    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(screen.getAllByRole("button", { name: /^重新查询：/ })).toHaveLength(5);
    expect(screen.getByLabelText("还有更多查询记录")).toBeInTheDocument();
    expect(listHistory()).toHaveLength(12);

    availableHeight = 700;
    fireEvent(window, new Event("resize"));
    expect(screen.getAllByRole("button", { name: /^重新查询：/ })).toHaveLength(12);
    expect(screen.queryByLabelText("还有更多查询记录")).not.toBeInTheDocument();
  });

  it("reopens any query type and clears saved history", () => {
    addHistory({ query: "中文查询", kind: "phrase", source: "AI 翻译接口" });
    render(<MemoryRouter><HomePage /><LocationProbe /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "重新查询：中文查询" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/query?q=%E4%B8%AD%E6%96%87%E6%9F%A5%E8%AF%A2");

    fireEvent.click(screen.getByRole("button", { name: "清除记录" }));
    expect(listHistory()).toEqual([]);
    expect(screen.getByText("暂无查询记录")).toBeInTheDocument();
  });

  it("shows a saved Chinese meaning or summary beneath each query", () => {
    addHistory({ query: "serendipity", kind: "word", source: "ECDICT", preview: "机缘巧合；意外发现美好事物的能力" });
    addHistory({ query: "the weather is getting warmer", kind: "text", source: "AI 翻译接口", preview: "天气正在变得越来越暖。" });

    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(screen.getByText("机缘巧合；意外发现美好事物的能力")).toBeInTheDocument();
    expect(screen.getByText("天气正在变得越来越暖。")).toBeInTheDocument();
  });

  it("opens the complete query history from the home page", () => {
    render(<MemoryRouter><HomePage /><LocationProbe /></MemoryRouter>);

    fireEvent.click(screen.getByRole("link", { name: "查看历史记录" }));

    expect(screen.getByTestId("location")).toHaveTextContent("/records");
  });

  it("consumes cancellation of a background history lookup when leaving home", async () => {
    addHistory({ query: "tauri", kind: "word", source: "词库解释" });
    const lookup = vi.spyOn(translationService, "resolveQuery").mockImplementation((_query, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")));
    }));
    const view = render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(lookup).toHaveBeenCalledOnce();
    await act(async () => { view.unmount(); });
    expect(listHistory()[0]?.preview).toBeUndefined();
  });

  it("routes phrase searches to the unified translation page", () => {
    render(<MemoryRouter><HomePage /><LocationProbe /></MemoryRouter>);

    fireEvent.change(screen.getByRole("textbox", { name: "输入需要查询的内容" }), {
      target: { value: "phase out subsidies" },
    });
    fireEvent.submit(screen.getByRole("textbox", { name: "输入需要查询的内容" }).closest("form")!);

    expect(screen.getByTestId("location")).toHaveTextContent("/query?q=phase%20out%20subsidies");
  });
});

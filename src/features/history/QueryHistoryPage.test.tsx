import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addHistory, listHistory } from "./historyStore";
import { QueryHistoryPage } from "./QueryHistoryPage";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

describe("QueryHistoryPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T12:00:00+08:00"));
  });
  afterEach(() => vi.useRealTimers());

  it("lists queries without redundant type labels and reopens a selected query", () => {
    addHistory({ query: "a deliberately long query", kind: "text", source: "AI 翻译接口", preview: "这是对应的中文解释" });
    render(<MemoryRouter initialEntries={["/records"]}><QueryHistoryPage /><LocationProbe /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "查询历史" })).toBeInTheDocument();
    expect(screen.queryByText("文本")).not.toBeInTheDocument();
    expect(screen.getByText("这是对应的中文解释")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /a deliberately long query/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("/query?q=a%20deliberately%20long%20query");
  });

  it("clears the history and returns to the empty state", () => {
    addHistory({ query: "serendipity", kind: "word", source: "ECDICT" });
    render(<MemoryRouter><QueryHistoryPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "清除记录" }));

    expect(listHistory()).toEqual([]);
    expect(screen.getByRole("heading", { name: "还没有查询记录" })).toBeInTheDocument();
  });
});

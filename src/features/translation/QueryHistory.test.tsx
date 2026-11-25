import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { addHistory } from "../history/historyStore";
import { QueryHistory } from "./QueryHistory";

describe("QueryHistory", () => {
  it("shows recent queries and selects one", () => {
    window.localStorage.clear();
    addHistory({ query: "climate change", kind: "phrase", source: "AI 翻译接口" });
    const onSelect = vi.fn();

    render(<QueryHistory onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "重新查询：climate change" }));
    expect(onSelect).toHaveBeenCalledWith("climate change");
  });

  it("shows an empty state when there is no history", () => {
    window.localStorage.clear();

    render(<QueryHistory onSelect={vi.fn()} />);

    expect(screen.getByTestId("query-history")).toHaveTextContent("暂无查询历史");
  });
});

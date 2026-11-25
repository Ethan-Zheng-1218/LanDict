import { beforeEach, describe, expect, it } from "vitest";

import { addHistory, clearHistory, HISTORY_STORAGE_KEY, listHistory } from "./historyStore";

describe("history store", () => {
  beforeEach(() => window.localStorage.clear());

  it("stores normalized queries and refreshes duplicate entries", () => {
    addHistory({ query: "  Serendipity ", kind: "word", source: "Collins" });
    const first = listHistory()[0];
    addHistory({ query: "serendipity", kind: "word", source: "Oxford" });

    expect(listHistory()).toHaveLength(1);
    expect(listHistory()[0]).toMatchObject({ query: "serendipity", source: "Oxford" });
    expect(listHistory()[0].id).toBe(first.id);
    expect(window.localStorage.getItem(HISTORY_STORAGE_KEY)).toContain('"version":1');
  });

  it("limits history to the newest thirty entries", () => {
    for (let index = 0; index < 31; index += 1) {
      addHistory({ query: `word-${index}`, kind: "word", source: "local" });
    }

    expect(listHistory()).toHaveLength(30);
    expect(listHistory()[0].query).toBe("word-30");
  });

  it("clears every saved query", () => {
    addHistory({ query: "serendipity", kind: "word", source: "ECDICT" });

    clearHistory();

    expect(listHistory()).toEqual([]);
  });
});

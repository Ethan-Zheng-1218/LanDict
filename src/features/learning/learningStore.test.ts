import { beforeEach, describe, expect, it } from "vitest";

import { addLearningEvent, LEARNING_STORAGE_KEY, listLearningEvents } from "./learningStore";

describe("learning store", () => {
  beforeEach(() => window.localStorage.clear());

  it("persists learning events with a timestamp", () => {
    const event = addLearningEvent({ type: "lookup", label: "serendipity" });

    expect(event.id).toBeTruthy();
    expect(event.createdAt).toBeTruthy();
    expect(listLearningEvents()).toMatchObject([{ type: "lookup", label: "serendipity" }]);
    expect(window.localStorage.getItem(LEARNING_STORAGE_KEY)).toContain('"version":1');
  });

  it("ignores malformed stored events", () => {
    window.localStorage.setItem(LEARNING_STORAGE_KEY, JSON.stringify({ version: 1, data: [{ type: "bad" }] }));

    expect(listLearningEvents()).toEqual([]);
  });
});

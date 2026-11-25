import { beforeEach, describe, expect, it } from "vitest";

import {
  READING_STORAGE_KEY,
  addReadingAnnotation,
  getReadingRecord,
  recordReadingWordQuery,
  removeReadingAnnotation,
  updateReadingFavorite,
  updateReadingProgress,
} from "./readingStore";

describe("reading store", () => {
  beforeEach(() => window.localStorage.clear());

  it("persists progress and restores it after reading the article again", () => {
    updateReadingProgress("global-push-clean-energy", 42, "Global Push for Clean Energy Gains Momentum");

    expect(getReadingRecord("global-push-clean-energy")).toMatchObject({
      articleId: "global-push-clean-energy",
      progress: 42,
      completed: false,
      title: "Global Push for Clean Energy Gains Momentum",
    });
    expect(window.localStorage.getItem(READING_STORAGE_KEY)).toContain('"version":1');
  });

  it("clamps progress and marks an article complete at one hundred percent", () => {
    updateReadingProgress("article", 140);

    expect(getReadingRecord("article")).toMatchObject({ progress: 100, completed: true });
  });

  it("adds and removes annotations through the shared record", () => {
    const annotation = addReadingAnnotation("article", {
      id: "annotation-1",
      start: 0,
      end: 5,
      quote: "Hello",
      kind: "note",
      note: "记住这个表达",
      createdAt: 1,
    });

    expect(getReadingRecord("article")?.annotations).toEqual([annotation]);

    removeReadingAnnotation("article", annotation.id);
    expect(getReadingRecord("article")?.annotations).toEqual([]);
  });

  it("records queried words per article without duplicate counts", () => {
    recordReadingWordQuery("article", "Subsidy", "Article");
    recordReadingWordQuery("article", "subsidy", "Article");
    recordReadingWordQuery("other", "subsidy", "Other");

    expect(getReadingRecord("article")?.queriedWords).toEqual(["subsidy"]);
    expect(getReadingRecord("other")?.queriedWords).toEqual(["subsidy"]);
  });

  it("ignores malformed stored reading records", () => {
    window.localStorage.setItem(READING_STORAGE_KEY, JSON.stringify({ version: 1, data: [{ articleId: "bad" }] }));

    expect(getReadingRecord("bad")).toBeUndefined();
  });

  it("persists article favorites in the shared reading record", () => {
    updateReadingFavorite("article", true, "Article");

    expect(getReadingRecord("article")).toMatchObject({ articleId: "article", favorite: true, title: "Article" });
  });
});

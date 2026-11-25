import { beforeEach, describe, expect, it, vi } from "vitest";

import { FEED_STORAGE_KEY, clearExpiredFeedItems, listFeedItems, refreshBbcFeedOnce, refreshReadingFeed, resetFeedRefreshForTests, saveFeedItems } from "./feedRepository";
import type { BbcFeedItem } from "./bbcSource";

const cachedItem: BbcFeedItem = {
  id: "bbc-cached",
  source: "bbc",
  title: "Cached story",
  summary: "Cached summary",
  originalUrl: "https://www.bbc.com/news/articles/cached",
  publishedAt: "2026-10-04T08:00:00.000Z",
  category: "World",
  downloaded: false,
};

const freshItem: BbcFeedItem = { ...cachedItem, id: "bbc-fresh", title: "Fresh story" };

describe("feed repository", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetFeedRefreshForTests();
  });

  it("returns cached items immediately before any refresh", () => {
    saveFeedItems([cachedItem]);

    expect(listFeedItems()).toEqual([cachedItem]);
    expect(window.localStorage.getItem(FEED_STORAGE_KEY)).toContain("bbc-cached");
  });

  it("refreshes only once per runtime and keeps cache on failure", async () => {
    saveFeedItems([cachedItem]);
    const loader = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(refreshBbcFeedOnce({ loader, now: new Date("2026-10-04T12:00:00.000Z") })).resolves.toEqual([cachedItem]);
    await refreshBbcFeedOnce({ loader, now: new Date("2026-10-04T12:00:00.000Z") });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(listFeedItems()).toEqual([cachedItem]);
  });

  it("merges fresh items and preserves downloaded entries during expiry cleanup", async () => {
    const downloaded = { ...cachedItem, downloaded: true, localArticleId: "bbc-cached" };
    saveFeedItems([downloaded]);
    const loader = vi.fn().mockResolvedValue([freshItem]);

    await refreshBbcFeedOnce({ loader, now: new Date("2026-10-04T12:00:00.000Z") });
    clearExpiredFeedItems(new Date("2026-10-04T12:00:00.000Z"));

    expect(listFeedItems().map((item) => item.id)).toEqual(["bbc-fresh"]);
    expect(listFeedItems().find((item) => item.id === "bbc-fresh")?.downloaded).toBe(true);
  });

  it("manually fetches newer content after the automatic refresh and on every later refresh", async () => {
    const now = new Date("2026-10-04T12:00:00.000Z");
    await refreshBbcFeedOnce({ loader: async () => [cachedItem], now });
    await refreshReadingFeed({ loader: async () => [freshItem], now });
    expect(listFeedItems()[0].title).toBe("Fresh story");
    await refreshReadingFeed({ loader: async () => [{ ...freshItem, title: "Updated again" }], now });
    expect(listFeedItems()[0].title).toBe("Updated again");
  });

  it("reports total source failure without deleting cache and allows retry", async () => {
    saveFeedItems([cachedItem]);
    const now = new Date("2026-10-04T12:00:00.000Z");
    await expect(refreshReadingFeed({ loader: async () => ({ items: [], successfulSources: [] }), now })).rejects.toThrow();
    expect(listFeedItems()).toEqual([cachedItem]);
    await refreshReadingFeed({ loader: async () => [freshItem], now });
    expect(listFeedItems()[0].title).toBe("Fresh story");
  });

  it("preserves failed sources and downloaded metadata on a partial refresh", async () => {
    const article = { ...cachedItem, id: "aeon-cached", source: "aeon" as const, originalUrl: "https://aeon.co/essays/cached", contentType: "article" as const };
    saveFeedItems([{ ...cachedItem, downloaded: true, localArticleId: "saved-document" }, article]);
    const result = await refreshReadingFeed({ loader: async () => ({ items: [freshItem], successfulSources: ["bbc"] }), now: new Date("2026-10-04T12:00:00.000Z") });
    expect(result.partial).toBe(true);
    expect(listFeedItems().find((item) => item.id === "aeon-cached")).toEqual(article);
    expect(listFeedItems().find((item) => item.id === "bbc-fresh")).toMatchObject({ downloaded: true, localArticleId: "saved-document" });
  });

  it("shares the in-flight automatic request with a manual refresh", async () => {
    let finish!: (items: BbcFeedItem[]) => void;
    const now = new Date("2026-10-04T12:00:00.000Z");
    const automatic = refreshBbcFeedOnce({ loader: () => new Promise((resolve) => { finish = resolve; }), now });
    const manual = refreshReadingFeed({ loader: async () => { throw new Error("Duplicate request"); }, now });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    finish([freshItem]);
    await expect(automatic).resolves.toEqual([freshItem]);
    await expect(manual).resolves.toMatchObject({ items: [freshItem] });
  });
});

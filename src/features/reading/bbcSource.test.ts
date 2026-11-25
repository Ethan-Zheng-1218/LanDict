import { beforeEach, describe, expect, it, vi } from "vitest";

import feedXml from "./fixtures/bbc-feed.xml?raw";
import { fetchBbcArticle, fetchBbcFeed, type BbcFetch } from "./bbcSource";

const now = new Date("2026-10-04T12:00:00.000Z");

function response(body: string, ok = true): Response {
  return { ok, status: ok ? 200 : 503, text: () => Promise.resolve(body) } as Response;
}

describe("BBC source", () => {
  it("parses the live RSS-to-JSON fallback response", async () => {
    const fetcher = vi.fn<BbcFetch>().mockResolvedValue(new Response(JSON.stringify({
      status: "ok",
      items: [{
        title: "Live BBC story",
        pubDate: "2026-10-04 08:00:00",
        link: "https://www.bbc.co.uk/news/articles/live123",
        guid: "https://www.bbc.co.uk/news/articles/live123#1",
        thumbnail: "https://ichef.bbci.co.uk/live.jpg",
        description: "Live summary",
      }],
    }), { headers: { "content-type": "application/json" } }));

    await expect(fetchBbcFeed(fetcher, new Date("2026-10-04T12:00:00.000Z"))).resolves.toMatchObject([
      { title: "Live BBC story", summary: "Live summary", imageUrl: "https://ichef.bbci.co.uk/live.jpg" },
    ]);
  });

  beforeEach(() => vi.restoreAllMocks());

  it("keeps only valid BBC items from the last five days", async () => {
    const fetcher: BbcFetch = vi.fn().mockResolvedValue(response(feedXml));

    const items = await fetchBbcFeed(fetcher, now);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "bbc-abc123",
      source: "bbc",
      category: "Climate",
      imageUrl: "https://ichef.bbci.co.uk/news/1024/cpsprodpb/clean.jpg",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("routes every supported BBC hostname through the local article proxy", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("<main><p>Article body</p></main>"));
    vi.stubGlobal("fetch", fetcher);

    await expect(fetchBbcArticle("https://www.bbc.co.uk/news/articles/live123?at_campaign=rss")).resolves.toContain("Article body");
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/api/bbc-article?url="), undefined);
  });

  it("returns article HTML through the source boundary", async () => {
    const fetcher: BbcFetch = vi.fn().mockResolvedValue(response("<main><p>Article body</p></main>"));

    await expect(fetchBbcArticle("https://www.bbc.com/news/articles/abc123", fetcher)).resolves.toBe("<main><p>Article body</p></main>");
    expect(fetcher).toHaveBeenCalledWith("https://www.bbc.com/news/articles/abc123");
  });

  it("rejects failed network responses", async () => {
    const fetcher: BbcFetch = vi.fn().mockResolvedValue(response("", false));

    await expect(fetchBbcFeed(fetcher, now)).rejects.toThrow("BBC feed request failed");
  });
});

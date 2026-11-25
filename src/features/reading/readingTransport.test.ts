import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { fetchBbcArticle, fetchBbcFeed } from "./bbcSource";
import { fetchAllSourceFeeds, fetchSourceArticle, fetchSourceFeedItems } from "./newsSources";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));

const now = new Date("2026-10-06T12:00:00.000Z");
const rss = `<rss><channel><item><title>World climate story</title><link>https://www.bbc.com/news/articles/one</link><pubDate>Tue, 06 Oct 2026 08:00:00 GMT</pubDate></item></channel></rss>`;
const html = "<main><p>Native article body</p></main>";

describe("installed reading transport", () => {
  beforeEach(() => {
    vi.stubGlobal("window", new Proxy(window, {
      get(target, key) { return key === "location" ? { hostname: "tauri.localhost" } : Reflect.get(target, key); },
    }));
    // A packaged app has no local /api server.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("No development server")));
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command !== "reading_source" || !args || !("source" in args) || args.source !== "bbc" || !("url" in args)) throw new Error("Source unavailable");
      return { status: 200, body: String(args.url).includes("rss.xml") ? rss : html, contentType: "text/plain" };
    });
  });

  afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

  it("loads unified feeds and article HTML without the development proxy", async () => {
    await expect(fetchSourceFeedItems("bbc", undefined, now)).resolves.toMatchObject([{ title: "World climate story" }]);
    await expect(fetchSourceArticle("bbc", "https://www.bbc.com/news/articles/one")).resolves.toBe(html);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads the legacy BBC feed and article through the installed backend", async () => {
    await expect(fetchBbcFeed(undefined, now)).resolves.toMatchObject([{ title: "World climate story" }]);
    await expect(fetchBbcArticle("https://www.bbc.com/news/articles/one")).resolves.toBe(html);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps a successful source when other installed requests fail", async () => {
    await expect(fetchAllSourceFeeds(undefined, now)).resolves.toMatchObject({
      items: [{ source: "bbc", title: "World climate story" }], successfulSources: ["bbc"],
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the development proxy when Tauri runs on the Vite origin", async () => {
    vi.unstubAllGlobals();
    const fetcher = vi.fn().mockImplementation(async () => new Response(rss));
    vi.stubGlobal("fetch", fetcher);

    await expect(fetchSourceFeedItems("bbc", undefined, now)).resolves.toMatchObject([{ title: "World climate story" }]);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/api/reading-source?source=bbc"), undefined);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reports failed native HTTP responses as article download failures", async () => {
    vi.mocked(invoke).mockResolvedValue({ status: 503, body: "Source unavailable", contentType: "text/plain" });
    await expect(fetchSourceArticle("bbc", "https://www.bbc.com/news/articles/one")).rejects.toThrow("bbc article request failed");
  });
});

import { describe, expect, it } from "vitest";

import { parseRssFeed, parseVoaGlobalCoverage, selectTopFeedItems } from "./newsSources";

describe("unified reading news sources", () => {
  const now = new Date("2026-10-06T12:00:00.000Z");

  it("normalizes RSS candidates and keeps only the last five days", () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><guid>one</guid><title>Global climate story</title><link>https://example.com/one</link><description><![CDATA[Summary]]></description><pubDate>Tue, 06 Oct 2026 08:00:00 GMT</pubDate><category>World</category></item>
      <item><guid>old</guid><title>Old story</title><link>https://example.com/old</link><pubDate>Wed, 30 Sep 2026 08:00:00 GMT</pubDate></item>
    </channel></rss>`;

    expect(parseRssFeed(xml, { source: "cgtn", articleHosts: ["example.com"] }, now)).toMatchObject([
      { source: "cgtn", title: "Global climate story", category: "World", summary: "Summary" },
    ]);
  });

  it("reads current English VOA links from the official discovery page without CSS class selectors", () => {
    const html = `<main>
      <a href="https://www.voanews.com/a/english-story/123.html?utm_source=voa"><h4>English story</h4></a>
      <a href="https://ir.voanews.com/a/persian-story/456.html"><h4>Not English</h4></a>
      <a href="https://www.voanews.com/a/english-story/123.html"><h4>Duplicate</h4></a>
    </main>`;

    expect(parseVoaGlobalCoverage(html, now)).toEqual([
      expect.objectContaining({
        source: "voa",
        title: "English story",
        originalUrl: "https://www.voanews.com/a/english-story/123.html",
      }),
    ]);
  });

  it("selects no more than three high-scoring items per source and day", () => {
    const items = Array.from({ length: 5 }, (_, index) => ({
      id: `cgtn-${index}`,
      source: "cgtn" as const,
      title: `World climate technology story ${index}`,
      summary: "International climate and technology news",
      originalUrl: `https://www.cgtn.com/news/${index}`,
      publishedAt: `2026-10-06T0${index}:00:00.000Z`,
      category: "World",
      downloaded: false,
    }));

    expect(selectTopFeedItems(items, now)).toHaveLength(3);
  });

  it("marks RSS article sources and keeps their daily limit at one", () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><guid>aeon-one</guid><title>Ideas for a changing world</title><link>https://aeon.co/essays/one</link><description>Long-form ideas</description><pubDate>Tue, 06 Oct 2026 08:00:00 GMT</pubDate><enclosure url="https://aeon.co/images/one.jpg" type="image/jpeg" /></item>
      <item><guid>aeon-two</guid><title>Another essay</title><link>https://aeon.co/essays/two</link><description>Another long-form essay</description><pubDate>Tue, 06 Oct 2026 07:00:00 GMT</pubDate></item>
    </channel></rss>`;
    const items = parseRssFeed(xml, { source: "aeon", articleHosts: ["aeon.co"], articlePath: /^\/essays\//, contentType: "article" }, now);

    expect(items[0]).toMatchObject({ source: "aeon", contentType: "article", imageUrl: "https://aeon.co/images/one.jpg" });
    expect(selectTopFeedItems(items, now)).toHaveLength(1);
  });
});

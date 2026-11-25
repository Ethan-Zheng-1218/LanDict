import { describe, expect, it } from "vitest";

import articleHtml from "./fixtures/bbc-article.html?raw";
import type { BbcFeedItem } from "./bbcSource";
import { parseBbcArticle } from "./bbcParser";

const feedItem: BbcFeedItem = {
  id: "bbc-abc123",
  source: "bbc",
  title: "Clean energy investment is growing",
  summary: "Countries are investing more in clean energy.",
  originalUrl: "https://www.bbc.com/news/articles/abc123",
  publishedAt: "2026-10-04T08:00:00.000Z",
  category: "Climate",
  imageUrl: "https://ichef.bbci.co.uk/news/1024/cpsprodpb/clean.jpg",
  downloaded: false,
};

describe("BBC article parser", () => {
  it("converts BBC body content into safe ArticleDocument blocks", () => {
    const document = parseBbcArticle(articleHtml, feedItem);

    expect(document).toMatchObject({
      id: "bbc-abc123",
      source: "bbc",
      title: "Clean energy investment is growing",
      downloaded: false,
    });
    expect(document.blocks).toEqual([
      { id: "paragraph-1", type: "paragraph", text: "Countries are investing more in clean energy." },
      { id: "heading-1", type: "heading", level: 2, text: "A changing economic case" },
      { id: "image-1", type: "image", src: "https://ichef.bbci.co.uk/news/1024/cpsprodpb/clean.jpg", alt: "Solar panels", caption: "Solar power is expanding." },
      { id: "quote-1", type: "quote", text: "Investment is changing the energy system.", attribution: "Energy analyst" },
      { id: "list-1", type: "list", ordered: false, items: ["Lower costs", "More jobs"] },
      { id: "paragraph-2", type: "paragraph", text: "The next phase will depend on infrastructure." },
    ]);
    expect(JSON.stringify(document.blocks)).not.toContain("Advertisement");
    expect(JSON.stringify(document.blocks)).not.toContain("BBC footer");
    expect(JSON.stringify(document.blocks)).not.toContain("Related");
    expect(JSON.stringify(document.blocks)).not.toContain("Read another story");
    expect(JSON.stringify(document.blocks)).not.toContain("More on this story");
    expect(JSON.stringify(document.blocks)).not.toContain("cockroach");
    expect(JSON.stringify(document.blocks)).not.toContain("2 days ago");
  });

  it("drops BBC onward-journey modules even when they are not marked with a related class", () => {
    const html = `<html><body><main data-testid="article-body">
      <p>Only the news body should survive.</p>
      <div data-block="promoList"><div><h2>More on this story</h2><ul><li><div data-testid="promo"><p>Another story</p></div></li></ul></div></div>
    </main></body></html>`;

    const document = parseBbcArticle(html, feedItem);

    expect(document.blocks).toEqual([{ id: "paragraph-1", type: "paragraph", text: "Only the news body should survive." }]);
  });

  it("drops share, follow, and print controls from a BBC article body", () => {
    const html = `<html><body><main data-testid="article-body">
      <p>The first news paragraph.</p>
      <div class="content-sharing"><p>Share</p></div>
      <div class="follow-us"><p>Follow us</p></div>
      <div class="print-controls"><p>Print</p></div>
      <p>The second news paragraph.</p>
    </main></body></html>`;

    const document = parseBbcArticle(html, feedItem);

    expect(document.blocks).toEqual([
      { id: "paragraph-1", type: "paragraph", text: "The first news paragraph." },
      { id: "paragraph-2", type: "paragraph", text: "The second news paragraph." },
    ]);
  });

  it("rejects a BBC document without a readable article body", () => {
    expect(() => parseBbcArticle("<html><body><nav>Only navigation</nav></body></html>", feedItem)).toThrow("BBC article body not found");
  });
});

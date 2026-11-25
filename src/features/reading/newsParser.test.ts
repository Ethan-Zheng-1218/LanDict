import { describe, expect, it } from "vitest";

import type { FeedItem } from "./feedItem";
import { parseNewsArticle } from "./newsParser";

const item: FeedItem = {
  id: "cgtn-article",
  source: "cgtn",
  title: "A global story",
  summary: "Summary",
  originalUrl: "https://news.cgtn.com/news/2026-10-06/story.html",
  publishedAt: "2026-10-06T08:00:00.000Z",
  category: "World",
  downloaded: false,
};

describe("generic news parser", () => {
  it("converts semantic content into ArticleDocument blocks and removes related content", () => {
    const document = parseNewsArticle(`<html><head>
      <meta property="og:title" content="A global story" />
      <meta property="og:description" content="A summary" />
    </head><body><article>
      <h1>A global story</h1><p>First paragraph.</p><h2>Context</h2>
      <figure><img src="/photo.jpg" alt="A photo" /><figcaption>Caption</figcaption></figure>
      <blockquote>A quote</blockquote><ul><li>One</li><li>Two</li></ul>
      <section class="related"><h2>Related</h2><p>Do not include this.</p></section>
    </article></body></html>`, item);

    expect(document.source).toBe("cgtn");
    expect(document.blocks.map((block) => block.type)).toEqual(["paragraph", "heading", "image", "quote", "list"]);
    expect(JSON.stringify(document.blocks)).not.toContain("Do not include this");
  });

  it("keeps only Quanta's article body and omits page controls and related stories", () => {
    const quantaItem: FeedItem = {
      ...item,
      id: "quanta-article",
      source: "quanta",
      originalUrl: "https://www.quantamagazine.org/a-quanta-story-20261005/",
      category: "Mathematics",
      contentType: "article",
    };
    const document = parseNewsArticle(`<main><article>
      <section class="post__title__meta"><h2>Comment Comments</h2><p>Save Article Read Later</p></section>
      <section class="outer--content"><div class="post__content__section">
        <p>The first real paragraph.</p><h2>Mathematical consequences</h2><p>The second real paragraph.</p>
        <h2>Related:</h2><p>Do not include this related story.</p>
      </div></section>
      <aside><h3>Also in Mathematics</h3><p>Unrelated sidebar story.</p></aside>
    </article></main>`, quantaItem);

    expect(document.blocks).toEqual([
      { id: "paragraph-1", type: "paragraph", text: "The first real paragraph." },
      { id: "heading-1", type: "heading", level: 2, text: "Mathematical consequences" },
      { id: "paragraph-2", type: "paragraph", text: "The second real paragraph." },
    ]);
  });

  it("keeps only Aeon's story body instead of its deck, listen controls, and appendix", () => {
    const aeonItem: FeedItem = {
      ...item,
      id: "aeon-article",
      source: "aeon",
      title: "A life in episodes",
      summary: "A memoir published in public.",
      originalUrl: "https://aeon.co/essays/a-life-in-episodes",
      contentType: "article",
    };
    const document = parseNewsArticle(`<main>
      <h1>A life in episodes</h1><h2>A memoir published in public.</h2>
      <article><div class="article-content">
        <div class="listen-controls"><p>Listen to this essay</p><p>34 minute listen</p></div>
        <div class="has-dropcap"><p>The first real paragraph.</p><h2>A real section title</h2><p>The next real paragraph.</p></div>
        <div class="no-pagemarks"><p>Suggested essay that is not part of this article.</p></div>
      </div></article>
    </main>`, aeonItem);

    expect(document.title).toBe("A life in episodes");
    expect(document.blocks).toEqual([
      { id: "paragraph-1", type: "paragraph", text: "The first real paragraph." },
      { id: "heading-1", type: "heading", level: 2, text: "A real section title" },
      { id: "paragraph-2", type: "paragraph", text: "The next real paragraph." },
    ]);
  });

  it("uses Rest of World's post content and keeps its real section headings", () => {
    const restOfWorldItem: FeedItem = {
      ...item,
      id: "rest-of-world-article",
      source: "rest-of-world",
      originalUrl: "https://restofworld.org/2026/a-global-tech-story/",
      contentType: "article",
    };
    const document = parseNewsArticle(`<main><article>
      <header><h2>Not a chapter title</h2><p>Byline and article controls.</p></header>
      <div class="post-content"><p>The first real paragraph.</p><h2>What changes next</h2><p>The next real paragraph.</p></div>
      <section class="related"><h2>Related</h2><p>Do not include this recommendation.</p></section>
    </article></main>`, restOfWorldItem);

    expect(document.blocks).toEqual([
      { id: "paragraph-1", type: "paragraph", text: "The first real paragraph." },
      { id: "heading-1", type: "heading", level: 2, text: "What changes next" },
      { id: "paragraph-2", type: "paragraph", text: "The next real paragraph." },
    ]);
  });

  it("omits Works in Progress newsletter modules while preserving its section headings", () => {
    const worksInProgressItem: FeedItem = {
      ...item,
      id: "works-in-progress-article",
      source: "works-in-progress",
      originalUrl: "https://worksinprogress.co/issue/a-long-read/",
      contentType: "article",
    };
    const document = parseNewsArticle(`<main><article>
      <header><h2>Story deck that is not a chapter</h2></header>
      <div class="single-article__article-content">
        <p>The first real paragraph.</p>
        <section class="newsletter-signup"><p>Get new articles delivered to your inbox.</p></section>
        <h3>A real section title</h3><p>The next real paragraph.</p>
      </div>
    </article></main>`, worksInProgressItem);

    expect(document.blocks).toEqual([
      { id: "paragraph-1", type: "paragraph", text: "The first real paragraph." },
      { id: "heading-1", type: "heading", level: 3, text: "A real section title" },
      { id: "paragraph-2", type: "paragraph", text: "The next real paragraph." },
    ]);
  });

  it("keeps VOA controls and authors out of the body while deduplicating its editorial note", () => {
    const voaItem: FeedItem = {
      ...item,
      id: "voa-article",
      source: "voa",
      title: "Russia's Putin reiterates nuclear threat against NATO",
      summary: "",
      originalUrl: "https://www.voanews.com/a/russia-putin-reiterates-nuclear-threat-against-nato/8208083.html",
    };
    const document = parseNewsArticle(`<html><head>
      <meta property="og:title" content="Russia's Putin reiterates nuclear threat against NATO" />
      <meta property="og:description" content="Editor's note: this story was translated from the original VOA Russian article. Russian President Vladimir Putin renewed his threat." />
      <meta name="Author" content="Andrey Nazarbekian" /><meta name="Author" content="Alex Grigoryev" />
    </head><body><article>
      <div class="content-sharing"><p>Share</p></div><div class="content-sharing"><p>Share</p></div>
      <div id="article-content"><div class="author-links"><p>By Andrey Nazarbekian</p><p>Alex Grigoryev</p></div><p>Editor's note: this story was translated from the original VOA Russian article.</p><p>The first real paragraph.</p></div>
      <div class="follow-us"><p>Follow us</p></div><div class="print-controls"><p>Print</p></div>
    </article></body></html>`, voaItem);

    expect(document.author).toBe("Andrey Nazarbekian · Alex Grigoryev");
    expect(document.summary).toBe("Russian President Vladimir Putin renewed his threat.");
    expect(document.blocks).toEqual([
      { id: "paragraph-1", type: "paragraph", text: "Editor's note: this story was translated from the original VOA Russian article." },
      { id: "paragraph-2", type: "paragraph", text: "The first real paragraph." },
    ]);
    expect(JSON.stringify(document.blocks)).not.toContain("Andrey Nazarbekian");
    expect(JSON.stringify(document.blocks)).not.toContain("Share");
    expect(JSON.stringify(document.blocks)).not.toContain("Follow us");
    expect(JSON.stringify(document.blocks)).not.toContain("Print");
  });
});

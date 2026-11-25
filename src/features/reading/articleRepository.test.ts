import { beforeEach, describe, expect, it } from "vitest";

import { ARTICLE_EXTRACTOR_VERSION, ARTICLE_STORAGE_KEY, clearExpiredFeedArticles, getArticleDocument, listDownloadedArticles, needsArticleReextraction, saveArticleDocument } from "./articleRepository";
import type { ArticleDocument } from "./articleDocument";

const documentFixture: ArticleDocument = {
  id: "bbc-article-1",
  source: "bbc",
  title: "A BBC article",
  summary: "A short summary",
  originalUrl: "https://www.bbc.com/news/articles/abc",
  publishedAt: "2026-10-04T08:00:00.000Z",
  category: "World",
  imageUrl: "https://ichef.bbci.co.uk/news/1024/cpsprodpb/example.jpg",
  downloaded: false,
  blocks: [
    { id: "p-1", type: "paragraph", text: "A paragraph." },
    { id: "h-1", type: "heading", level: 2, text: "A heading" },
  ],
};

describe("article repository", () => {
  beforeEach(() => window.localStorage.clear());

  it("saves and restores a unified ArticleDocument", () => {
    saveArticleDocument(documentFixture);

    expect(getArticleDocument(documentFixture.id)).toEqual(documentFixture);
    expect(window.localStorage.getItem(ARTICLE_STORAGE_KEY)).toContain('"version":1');
  });

  it("keeps downloaded documents when expired feed articles are cleared", () => {
    saveArticleDocument(documentFixture);
    saveArticleDocument({ ...documentFixture, id: "bbc-downloaded", downloaded: true, downloadedAt: "2026-10-04T09:00:00.000Z" });

    clearExpiredFeedArticles([documentFixture.id, "bbc-downloaded"]);

    expect(getArticleDocument(documentFixture.id)).toBeUndefined();
    expect(getArticleDocument("bbc-downloaded")).toBeDefined();
    expect(listDownloadedArticles()).toHaveLength(1);
  });

  it("ignores malformed ArticleDocuments in storage", () => {
    window.localStorage.setItem(ARTICLE_STORAGE_KEY, JSON.stringify({ version: 1, data: [{ id: "bad" }] }));

    expect(getArticleDocument("bad")).toBeUndefined();
  });

  it("re-extracts BBC documents that were produced by an older extractor", () => {
    expect(needsArticleReextraction(documentFixture)).toBe(true);
    expect(needsArticleReextraction({ ...documentFixture, extractorVersion: ARTICLE_EXTRACTOR_VERSION })).toBe(false);
    expect(needsArticleReextraction({ ...documentFixture, source: "bundled", extractorVersion: undefined })).toBe(false);
  });
});

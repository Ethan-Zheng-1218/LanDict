import type { ArticleDocument } from "./articleDocument";
import { ARTICLE_EXTRACTOR_VERSION, saveArticleDocument } from "./articleRepository";
import type { FeedItem } from "./feedItem";
import { SOURCE_ADAPTERS, type ExternalArticleSource, fetchSourceArticle } from "./newsSources";
import { updateFeedItem } from "./feedRepository";

/** Rebuilds the feed metadata a parser needs from an already stored document. */
export function feedItemFromDocument(document: ArticleDocument): FeedItem {
  const source: ExternalArticleSource = document.source === "bundled" ? "bbc" : document.source;
  return {
    id: document.id,
    source,
    title: document.title,
    summary: document.summary,
    originalUrl: document.originalUrl,
    publishedAt: document.publishedAt,
    category: document.category,
    contentType: document.contentType ?? (["rest-of-world", "aeon", "quanta", "works-in-progress"].includes(document.source) ? "article" : "news"),
    imageUrl: document.imageUrl,
    downloaded: document.downloaded,
    localArticleId: document.id,
  };
}

/**
 * Fetches a BBC article, strips everything that is not the news body, and caches the
 * result. This is the single entry point for producing an ArticleDocument from a feed item.
 */
export async function extractArticleDocument(item: FeedItem, options: { download?: boolean } = {}): Promise<ArticleDocument> {
  const adapter = SOURCE_ADAPTERS[item.source];
  const html = await fetchSourceArticle(item.source, item.originalUrl);
  const parsed = adapter.parseArticle(html, item);
  const coverImageUrl = parsed.imageUrl ?? parsed.blocks.find((block) => block.type === "image")?.src;
  const document: ArticleDocument = {
    ...parsed,
    imageUrl: coverImageUrl,
    extractorVersion: ARTICLE_EXTRACTOR_VERSION,
    downloaded: Boolean(options.download) || parsed.downloaded,
    downloadedAt: options.download ? new Date().toISOString() : parsed.downloadedAt,
  };
  saveArticleDocument(document);
  updateFeedItem(item.id, { imageUrl: coverImageUrl, localArticleId: document.id });
  return document;
}

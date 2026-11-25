import { readStored, writeStored } from "../../lib/browserStorage";
import type { ArticleBlock, ArticleDocument } from "./articleDocument";

export const ARTICLE_STORAGE_KEY = "landict.reading.articles.v1";

/**
 * Bump when any source extraction rules change, so documents cached by an older
 * extractor (for example ones that still contain "More on this story") are refreshed.
 */
export const ARTICLE_EXTRACTOR_VERSION = 5;

const isArticleBlock = (value: unknown): value is ArticleBlock => {
  if (!value || typeof value !== "object") return false;
  const block = value as Partial<ArticleBlock>;
  if (typeof block.id !== "string" || typeof block.type !== "string") return false;
  if (block.type === "paragraph" || block.type === "quote") return typeof block.text === "string";
  if (block.type === "heading") return (block.level === 2 || block.level === 3) && typeof block.text === "string";
  if (block.type === "image") return typeof block.src === "string" && typeof block.alt === "string" && (block.caption === undefined || typeof block.caption === "string");
  if (block.type === "list") return typeof block.ordered === "boolean" && Array.isArray(block.items) && block.items.every((item) => typeof item === "string");
  return false;
};

export const isArticleDocument = (value: unknown): value is ArticleDocument => {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<ArticleDocument>;
  return typeof document.id === "string" && document.id.length > 0
    && (["bbc", "cgtn", "voa", "un-news", "rest-of-world", "aeon", "quanta", "works-in-progress", "bundled"] as ArticleDocument["source"][]).includes(document.source as ArticleDocument["source"])
    && typeof document.title === "string" && typeof document.summary === "string"
    && typeof document.originalUrl === "string" && typeof document.publishedAt === "string"
    && typeof document.category === "string" && typeof document.downloaded === "boolean"
    && (document.downloadedAt === undefined || typeof document.downloadedAt === "string")
    && (document.extractorVersion === undefined || typeof document.extractorVersion === "number")
    && Array.isArray(document.blocks) && document.blocks.every(isArticleBlock);
};

const isArticleDocumentList = (value: unknown): value is ArticleDocument[] => Array.isArray(value) && value.every(isArticleDocument);

function listAllArticles(): ArticleDocument[] {
  return readStored(ARTICLE_STORAGE_KEY, [], isArticleDocumentList);
}

function persist(documents: ArticleDocument[]) {
  writeStored(ARTICLE_STORAGE_KEY, documents);
}

export function getArticleDocument(articleId: string): ArticleDocument | undefined {
  return listAllArticles().find((document) => document.id === articleId);
}

export function needsArticleReextraction(document: ArticleDocument): boolean {
  return document.source !== "bundled" && document.extractorVersion !== ARTICLE_EXTRACTOR_VERSION;
}

export function saveArticleDocument(document: ArticleDocument): ArticleDocument {
  const documents = listAllArticles();
  const index = documents.findIndex((item) => item.id === document.id);
  if (index >= 0) documents[index] = document;
  else documents.push(document);
  persist(documents);
  return document;
}

export function listDownloadedArticles(): ArticleDocument[] {
  return listAllArticles().filter((document) => document.downloaded);
}

export function clearExpiredFeedArticles(articleIds: string[]): void {
  const expired = new Set(articleIds);
  persist(listAllArticles().filter((document) => !expired.has(document.id) || document.downloaded));
}

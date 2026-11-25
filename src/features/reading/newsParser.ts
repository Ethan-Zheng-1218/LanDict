import type { ArticleBlock, ArticleDocument } from "./articleDocument";
import type { FeedItem } from "./feedItem";

const SKIP_TAGS = new Set(["NAV", "ASIDE", "FOOTER", "HEADER", "SCRIPT", "STYLE", "FORM"]);
const RELATED_HEADING = /^(related|recommended|recommendations|more like this|more on this story|read more|you may also like|share|follow us|subscribe|print)\s*:?$/i;
const EXCLUDED_SELECTOR = "[data-testid*='related' i], [data-testid*='recommend' i], [class*='related' i], [class*='recommend' i], [class*='promo' i], [class*='advert' i], [class*='newsletter' i], [class*='share' i], [class*='sharing' i], [class*='follow' i], [class*='print' i], [id*='related' i], [id*='share' i], [aria-label*='related' i], [aria-label*='share' i]";
const SOURCE_BODY_SELECTORS: Partial<Record<FeedItem["source"], string>> = {
  "rest-of-world": ".post-content",
  aeon: ".article-content > .has-dropcap",
  quanta: ".post__content__section",
  "works-in-progress": ".single-article__article-content",
};
type ArticleBlockInput =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "image"; src: string; alt: string; caption?: string }
  | { type: "quote"; text: string; attribution?: string }
  | { type: "list"; ordered: boolean; items: string[] };

export function parseNewsArticle(html: string, feedItem: FeedItem): ArticleDocument {
  const document = new DOMParser().parseFromString(html, "text/html");
  const root = selectRoot(document, feedItem.source);
  if (!root) throw new Error(`${feedItem.source} article body not found`);
  const author = extractAuthors(document);
  const blocks: ArticleBlock[] = [];
  const counters = new Map<ArticleBlock["type"], number>();
  let reachedRelatedContent = false;
  const add = (block: ArticleBlockInput) => {
    const count = (counters.get(block.type) ?? 0) + 1;
    counters.set(block.type, count);
    blocks.push({ ...block, id: `${block.type}-${count}` } as ArticleBlock);
  };
  const visit = (node: Element) => {
    if (reachedRelatedContent) return;
    if (SKIP_TAGS.has(node.tagName) || node.matches(EXCLUDED_SELECTOR)) return;
    if (node.tagName === "FIGURE") {
      const image = node.querySelector("img");
      const src = safeUrl(image?.getAttribute("src") || image?.getAttribute("data-src") || undefined, feedItem.originalUrl);
      if (src) add({ type: "image", src, alt: image?.getAttribute("alt")?.trim() || `${feedItem.source} news image`, caption: node.querySelector("figcaption")?.textContent?.trim() || undefined });
      return;
    }
    if (node.tagName === "BLOCKQUOTE") {
      const text = node.textContent?.trim() ?? "";
      if (text) add({ type: "quote", text, attribution: node.querySelector("cite")?.textContent?.trim() || undefined });
      return;
    }
    if (node.tagName === "H2" || node.tagName === "H3") {
      const text = node.textContent?.trim() ?? "";
      if (RELATED_HEADING.test(text)) {
        reachedRelatedContent = true;
        return;
      }
      if (text) add({ type: "heading", level: node.tagName === "H2" ? 2 : 3, text });
      return;
    }
    if (node.tagName === "P") {
      const text = node.textContent?.trim() ?? "";
      if (isAuthorLine(text, author)) return;
      if (text) add({ type: "paragraph", text });
      return;
    }
    if (node.tagName === "UL" || node.tagName === "OL") {
      const items = [...node.children].filter((child) => child.tagName === "LI").map((item) => item.textContent?.trim() ?? "").filter(Boolean);
      if (items.length) add({ type: "list", ordered: node.tagName === "OL", items });
      return;
    }
    for (const child of [...node.children]) visit(child);
  };
  for (const child of [...root.children]) visit(child);
  if (!blocks.length) throw new Error(`${feedItem.source} article body not found`);
  return {
    id: feedItem.id,
    source: feedItem.source,
    title: document.querySelector("h1")?.textContent?.trim() || meta(document, "og:title") || feedItem.title,
    summary: cleanSummary(meta(document, "og:description") || feedItem.summary),
    author,
    originalUrl: feedItem.originalUrl,
    publishedAt: meta(document, "article:published_time") || feedItem.publishedAt,
    category: feedItem.category,
    contentType: feedItem.contentType ?? "news",
    imageUrl: safeUrl(feedItem.imageUrl, feedItem.originalUrl),
    downloaded: feedItem.downloaded,
    blocks,
  };
}

function selectRoot(document: Document, source: FeedItem["source"]): Element | null {
  if (source === "cgtn") return document.querySelector("article, .m-content, main") ?? null;
  if (source === "voa") return document.querySelector("#article-content") ?? document.querySelector("article, .wsw, main") ?? null;
  const sourceBody = SOURCE_BODY_SELECTORS[source];
  if (sourceBody) return document.querySelector(sourceBody) ?? document.querySelector("article, main");
  return document.querySelector("article.node--type-news-story, article, main") ?? null;
}

function meta(document: Document, property: string): string {
  return document.querySelector(`meta[property="${property}"], meta[name="${property}"]`)?.getAttribute("content")?.trim() ?? "";
}

function extractAuthors(document: Document): string | undefined {
  const authors = [...document.querySelectorAll("meta")]
    .filter((element) => element.getAttribute("name")?.toLowerCase() === "author")
    .map((element) => element.getAttribute("content")?.trim() ?? "")
    .filter(Boolean)
    .filter((author, index, values) => values.indexOf(author) === index);
  return authors.length ? authors.join(" · ") : undefined;
}

function cleanSummary(value: string): string {
  return value.replace(/^editor[’']s note:\s*[^.!?]*[.!?]\s*/i, "").trim();
}

function isAuthorLine(text: string, author?: string): boolean {
  if (!author) return false;
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  const authors = author.split(" · ").map((value) => value.trim().toLowerCase()).filter(Boolean);
  return authors.some((value) => normalized === value || normalized === `by ${value}`)
    || (normalized.startsWith("by ") && authors.some((value) => normalized.includes(value)));
}

function safeUrl(value: string | undefined, base: string): string | undefined {
  if (!value) return undefined;
  try { return new URL(value, base).href; } catch { return undefined; }
}

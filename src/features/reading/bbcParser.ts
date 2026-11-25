import type { ArticleBlock, ArticleDocument } from "./articleDocument";
import type { BbcFeedItem } from "./bbcSource";

const SKIP_TAGS = new Set(["NAV", "ASIDE", "FOOTER", "HEADER", "SCRIPT", "STYLE"]);

/**
 * BBC keeps its onward-journey modules ("More on this story", related articles, promos,
 * video playlists) inside the same article container as the story. They are not part of
 * the news body, so they must never reach the reader or the article outline.
 */
const ONWARD_JOURNEY_BLOCK = /promo|related|recommend|onward|links|playlist|watch|topic|top.?stories|most.?read|elsewhere|features|advert/i;
const ONWARD_JOURNEY_MODULE = "[data-block='promoList'], [data-testid='promo'], [data-testid='related-content'], [data-testid='topic-list']";
const EXCLUDED_SELECTOR = `${ONWARD_JOURNEY_MODULE}, [data-testid='ad'], [class*='advert' i], [class*='promo' i], [class*='recommend' i], [class*='related' i], [class*='share' i], [class*='sharing' i], [class*='follow' i], [class*='print' i], [id*='related' i], [id*='share' i], [aria-label*='related' i], [aria-label*='share' i]`;
const ONWARD_JOURNEY_HEADING = /^(related|related topics|related internet links|topics|recommended|recommendations|more like this|more on this story|more from .+|around the bbc|see also|top stories|most read|the video playlist|watch\b.*)$/i;

type ArticleBlockInput =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "image"; src: string; alt: string; caption?: string }
  | { type: "quote"; text: string; attribution?: string }
  | { type: "list"; ordered: boolean; items: string[] };

export function parseBbcArticle(html: string, feedItem: BbcFeedItem): ArticleDocument {
  const document = new DOMParser().parseFromString(html, "text/html");
  const root = document.querySelector("main[data-testid='article-body'], main, article");
  if (!root) throw new Error("BBC article body not found");

  const blocks: ArticleBlock[] = [];
  const counters = new Map<ArticleBlock["type"], number>();
  const add = (block: ArticleBlockInput) => {
    const count = (counters.get(block.type) ?? 0) + 1;
    counters.set(block.type, count);
    blocks.push({ ...block, id: `${block.type}-${count}` } as ArticleBlock);
  };

  const visit = (node: Element) => {
    if (SKIP_TAGS.has(node.tagName) || isExcludedNode(node)) return;
    if (node.tagName === "FIGURE") {
      const image = node.querySelector("img");
      const src = image ? safeUrl(image.getAttribute("src"), feedItem.originalUrl) : undefined;
      if (src) add({ type: "image", src, alt: image?.getAttribute("alt")?.trim() || "BBC News image", caption: node.querySelector("figcaption")?.textContent?.trim() || undefined });
      return;
    }
    if (node.tagName === "BLOCKQUOTE") {
      const quote = node.querySelector("p")?.textContent?.trim() || node.textContent?.trim() || "";
      if (quote) add({ type: "quote", text: quote, attribution: node.querySelector("cite")?.textContent?.trim() || undefined });
      return;
    }
    if (node.tagName === "H2" || node.tagName === "H3") {
      const text = node.textContent?.trim() ?? "";
      if (text) add({ type: "heading", level: node.tagName === "H2" ? 2 : 3, text });
      return;
    }
    if (node.tagName === "P") {
      const text = node.textContent?.trim() ?? "";
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
  if (!blocks.length) throw new Error("BBC article body not found");

  const title = meta(document, "og:title") || root.querySelector("h1")?.textContent?.trim() || feedItem.title;
  return {
    id: feedItem.id,
    source: "bbc",
    title,
    summary: meta(document, "og:description") || feedItem.summary,
    originalUrl: feedItem.originalUrl,
    publishedAt: meta(document, "article:published_time") || feedItem.publishedAt,
    category: feedItem.category,
    contentType: feedItem.contentType ?? "news",
    imageUrl: safeUrl(feedItem.imageUrl, feedItem.originalUrl),
    downloaded: feedItem.downloaded,
    blocks,
  };
}

function isExcludedNode(node: Element): boolean {
  if (node.matches(EXCLUDED_SELECTOR)) return true;
  const block = node.getAttribute("data-block");
  if (block && ONWARD_JOURNEY_BLOCK.test(block)) return true;
  const component = node.getAttribute("data-component");
  if (component && ONWARD_JOURNEY_BLOCK.test(component)) return true;
  if (!["H2", "H3", "H4", "SECTION", "DIV"].includes(node.tagName)) return false;
  return ONWARD_JOURNEY_HEADING.test(node.textContent?.trim() ?? "");
}

function meta(document: Document, property: string): string {
  return document.querySelector(`meta[property="${property}"], meta[name="${property}"]`)?.getAttribute("content")?.trim() ?? "";
}

function safeUrl(value: string | null | undefined, base: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

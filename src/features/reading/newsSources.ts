import type { ArticleDocument, ArticleSource } from "./articleDocument";
import { parseBbcArticle } from "./bbcParser";
import type { FeedItem } from "./feedItem";
import { parseNewsArticle } from "./newsParser";
import { usesDesktopBackend } from "../translation/dictionaryProvider";
import { fetchDesktopReadingSource } from "./readingTransport";

export type ExternalArticleSource = Exclude<ArticleSource, "bundled">;
export type SourceFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type SourceEndpointConfig = {
  source: ExternalArticleSource;
  feedUrls: string[];
  articleHosts: string[];
  articlePath: RegExp;
  contentType?: "news" | "article";
  maxPerDay?: number;
  discovery?: "rss" | "voa-global";
};

export const SOURCE_ENDPOINTS: Record<ExternalArticleSource, SourceEndpointConfig> = {
  bbc: {
    source: "bbc",
    feedUrls: [
      "https://feeds.bbci.co.uk/news/world/rss.xml",
      "https://feeds.bbci.co.uk/news/business/rss.xml",
      "https://feeds.bbci.co.uk/news/technology/rss.xml",
      "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml",
      "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",
    ],
    articleHosts: ["bbc.com", "www.bbc.com", "bbc.co.uk", "www.bbc.co.uk"],
    articlePath: /^\/news\//,
    discovery: "rss",
  },
  cgtn: {
    source: "cgtn",
    feedUrls: [
      "https://www.cgtn.com/subscribe/rss/section/world.xml",
      "https://www.cgtn.com/subscribe/rss/section/business.xml",
      "https://www.cgtn.com/subscribe/rss/section/tech-sci.xml",
      "https://www.cgtn.com/subscribe/rss/section/culture.xml",
    ],
    articleHosts: ["news.cgtn.com", "www.cgtn.com"],
    articlePath: /^\/news\//,
    discovery: "rss",
  },
  voa: {
    source: "voa",
    feedUrls: ["https://projects.voanews.com/global2/"],
    articleHosts: ["www.voanews.com"],
    articlePath: /^\/a\//,
    discovery: "voa-global",
  },
  "un-news": {
    source: "un-news",
    feedUrls: ["https://news.un.org/feed/subscribe/en/news/all/rss.xml"],
    articleHosts: ["news.un.org"],
    articlePath: /^\/en\/story\//,
    discovery: "rss",
  },
  "rest-of-world": {
    source: "rest-of-world",
    feedUrls: ["https://restofworld.org/feed/"],
    articleHosts: ["restofworld.org", "www.restofworld.org"],
    articlePath: /^\/(?!platforms\/|subscribe\/|about\/|inside\/).+/,
    contentType: "article",
    maxPerDay: 1,
    discovery: "rss",
  },
  aeon: {
    source: "aeon",
    feedUrls: ["https://aeon.co/feed"],
    articleHosts: ["aeon.co", "www.aeon.co"],
    articlePath: /^\/(essays|ideas|stories|films|magazine)\//,
    contentType: "article",
    maxPerDay: 1,
    discovery: "rss",
  },
  quanta: {
    source: "quanta",
    feedUrls: ["https://www.quantamagazine.org/feed/"],
    articleHosts: ["quantamagazine.org", "www.quantamagazine.org"],
    articlePath: /^\/[^/]+\/$/,
    contentType: "article",
    maxPerDay: 1,
    discovery: "rss",
  },
  "works-in-progress": {
    source: "works-in-progress",
    feedUrls: ["https://worksinprogress.co/rss.xml"],
    articleHosts: ["worksinprogress.co", "www.worksinprogress.co"],
    articlePath: /^\/(?!about\/|newsletter\/|feed\/).+/,
    contentType: "article",
    maxPerDay: 1,
    discovery: "rss",
  },
};

const DEFAULT_PROXY_PATH = "/api/reading-source";
const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
const TRACKING_PARAMS = /^(utm_|ref$|at_campaign$|at_medium$|at_source$)/i;

const defaultFetcher: SourceFetch = (input, init) => {
  if (typeof window !== "undefined" && input.startsWith("https://")) {
    const source = sourceForUrl(input);
    if (source) {
      if (usesDesktopBackend()) return fetchDesktopReadingSource(source, input, init?.signal ?? undefined);
      return fetch(`${DEFAULT_PROXY_PATH}?source=${source}&url=${encodeURIComponent(input)}`, init);
    }
  }
  return fetch(input, init);
};

export type SourceAdapter = {
  source: ExternalArticleSource;
  fetchFeed: (fetcher?: SourceFetch, now?: Date) => Promise<FeedItem[]>;
  fetchArticle: (url: string, fetcher?: SourceFetch) => Promise<string>;
  parseArticle: (html: string, item: FeedItem) => ArticleDocument;
};

export function parseRssFeed(xml: string, config: Pick<SourceEndpointConfig, "source" | "articleHosts" | "contentType"> & { articlePath?: RegExp }, now = new Date()): FeedItem[] {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) throw new Error(`${config.source} feed XML is invalid`);
  const cutoff = now.getTime() - FIVE_DAYS_MS;
  return [...document.querySelectorAll("item")].flatMap((item) => {
    const title = textContent(item, "title");
    const originalUrl = normalizeUrl(textContent(item, "link"));
    const publishedAt = textContent(item, "pubDate") || textContent(item, "published") || textContent(item, "updated");
    const timestamp = Date.parse(publishedAt);
    if (!title || !originalUrl || !Number.isFinite(timestamp) || timestamp < cutoff || timestamp > now.getTime()) return [];
    try {
      const url = new URL(originalUrl);
      if (!config.articleHosts.includes(url.hostname) || (config.articlePath && !config.articlePath.test(url.pathname))) return [];
      const guid = textContent(item, "guid") || url.pathname;
      const imageUrl = [...item.querySelectorAll("*")]
        .filter((element) => element.localName === "thumbnail" || element.localName === "content")
        .map((element) => element.getAttribute("url"))
        .find(Boolean)
        ?? item.querySelector("enclosure[type^='image/']")?.getAttribute("url")
        ?? item.querySelector("enclosure[type^='image/']")?.getAttribute("href")
        ?? undefined;
      return [{
        id: `${config.source}-${idPart(guid || originalUrl)}`,
        source: config.source,
        title,
        summary: stripMarkup(textContent(item, "description")),
        originalUrl,
        publishedAt: new Date(timestamp).toISOString(),
        category: textContent(item, "category") || defaultCategory(config.source),
        contentType: config.contentType ?? "news",
        imageUrl: normalizeOptionalUrl(imageUrl),
        downloaded: false,
      } satisfies FeedItem];
    } catch {
      return [];
    }
  });
}

export function parseVoaGlobalCoverage(html: string, now = new Date()): FeedItem[] {
  const document = new DOMParser().parseFromString(html, "text/html");
  const seen = new Set<string>();
  return [...document.querySelectorAll("a[href]")].flatMap((anchor) => {
    const href = anchor.getAttribute("href");
    const originalUrl = href ? normalizeUrl(href) : "";
    if (!isAllowedArticleUrl("voa", originalUrl) || seen.has(originalUrl)) return [];
    const title = anchor.querySelector("h1, h2, h3, h4, h5")?.textContent?.trim() || anchor.textContent?.trim() || "";
    if (!title) return [];
    seen.add(originalUrl);
    const imageUrl = anchor.querySelector("img")?.getAttribute("src") || anchor.querySelector("img")?.getAttribute("data-src") || undefined;
    return [{
      id: `voa-${idPart(originalUrl)}`,
      source: "voa" as const,
      title,
      summary: "",
      originalUrl,
      publishedAt: now.toISOString(),
      category: "VOA News",
      imageUrl: normalizeOptionalUrl(imageUrl),
      downloaded: false,
    } satisfies FeedItem];
  });
}

export function parseVoaArticleMetadata(html: string, item: FeedItem): FeedItem {
  const document = new DOMParser().parseFromString(html, "text/html");
  const publishedAt = meta(document, "article:published_time") || document.querySelector("time[datetime]")?.getAttribute("datetime") || item.publishedAt;
  const timestamp = Date.parse(publishedAt);
  return {
    ...item,
    title: meta(document, "og:title") || document.querySelector("h1")?.textContent?.trim() || item.title,
    summary: meta(document, "og:description") || item.summary,
    publishedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : item.publishedAt,
    imageUrl: normalizeOptionalUrl(meta(document, "og:image") || item.imageUrl),
  };
}

export function selectTopFeedItems(items: FeedItem[], now = new Date()): FeedItem[] {
  const uniqueItems = dedupeFeedItems(items);
  const candidates = uniqueItems
    .filter((item) => isRecent(item.publishedAt, now))
    .map((item) => ({ item, score: scoreFeedItem(item, now) + crossSourceCoverageBonus(item, uniqueItems) }))
    .sort((a, b) => b.score - a.score || b.item.publishedAt.localeCompare(a.item.publishedAt));
  const counts = new Map<string, number>();
  const selected: FeedItem[] = [];
  for (const candidate of candidates) {
    const day = candidate.item.publishedAt.slice(0, 10);
    const key = `${candidate.item.source}:${day}`;
    const count = counts.get(key) ?? 0;
    const maxPerDay = SOURCE_ENDPOINTS[candidate.item.source].maxPerDay ?? 3;
    if (count >= maxPerDay) continue;
    counts.set(key, count + 1);
    selected.push(candidate.item);
  }
  return selected.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export async function fetchSourceFeedItems(source: ExternalArticleSource, fetcher: SourceFetch = defaultFetcher, now = new Date()): Promise<FeedItem[]> {
  const config = SOURCE_ENDPOINTS[source];
  if (config.discovery === "voa-global") {
    const response = await fetcher(config.feedUrls[0]);
    if (!response.ok) throw new Error("VOA discovery request failed");
    const candidates = parseVoaGlobalCoverage(await response.text(), now);
    const enriched = await Promise.allSettled(candidates.slice(0, 24).map(async (item) => parseVoaArticleMetadata(await fetchSourceArticle(source, item.originalUrl, fetcher), item)));
    return selectTopFeedItems(enriched.flatMap((result) => result.status === "fulfilled" ? [result.value] : []), now);
  }
  const responses = await Promise.all(config.feedUrls.map(async (url) => {
    const response = await fetcher(url);
    if (!response.ok) throw new Error(`${source} feed request failed`);
    return response.text();
  }));
  return selectTopFeedItems(responses.flatMap((body) => parseRssFeed(body, config, now)), now);
}

export async function fetchSourceArticle(source: ExternalArticleSource, url: string, fetcher: SourceFetch = defaultFetcher): Promise<string> {
  if (!isAllowedArticleUrl(source, url)) throw new Error(`Unsupported ${source} article URL`);
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`${source} article request failed`);
  return response.text();
}

export const SOURCE_ADAPTERS: Record<ExternalArticleSource, SourceAdapter> = {
  bbc: createAdapter("bbc", (html, item) => parseBbcArticle(html, item)),
  cgtn: createAdapter("cgtn", (html, item) => parseNewsArticle(html, item)),
  voa: createAdapter("voa", (html, item) => parseNewsArticle(html, item)),
  "un-news": createAdapter("un-news", (html, item) => parseNewsArticle(html, item)),
  "rest-of-world": createAdapter("rest-of-world", (html, item) => parseNewsArticle(html, item)),
  aeon: createAdapter("aeon", (html, item) => parseNewsArticle(html, item)),
  quanta: createAdapter("quanta", (html, item) => parseNewsArticle(html, item)),
  "works-in-progress": createAdapter("works-in-progress", (html, item) => parseNewsArticle(html, item)),
};

export async function fetchAllSourceFeeds(fetcher?: SourceFetch, now = new Date()): Promise<{ items: FeedItem[]; successfulSources: ExternalArticleSource[] }> {
  const results = await Promise.all(Object.keys(SOURCE_ADAPTERS).map(async (source) => {
    const typedSource = source as ExternalArticleSource;
    try {
      return { source: typedSource, items: await SOURCE_ADAPTERS[typedSource].fetchFeed(fetcher, now) };
    } catch {
      return { source: typedSource, items: undefined };
    }
  }));
  return {
    items: selectTopFeedItems(results.flatMap((result) => result.items ?? []), now),
    successfulSources: results.filter((result) => result.items).map((result) => result.source),
  };
}

function createAdapter(source: ExternalArticleSource, parseArticle: (html: string, item: FeedItem) => ArticleDocument): SourceAdapter {
  return { source, fetchFeed: (fetcher, now) => fetchSourceFeedItems(source, fetcher, now), fetchArticle: (url, fetcher) => fetchSourceArticle(source, url, fetcher), parseArticle };
}

function sourceForUrl(url: string): ExternalArticleSource | undefined {
  return (Object.keys(SOURCE_ENDPOINTS) as ExternalArticleSource[]).find((source) => SOURCE_ENDPOINTS[source].feedUrls.includes(url) || isAllowedArticleUrl(source, url));
}

function isAllowedArticleUrl(source: ExternalArticleSource, value: string): boolean {
  try {
    const url = new URL(value);
    const config = SOURCE_ENDPOINTS[source];
    return config.articleHosts.includes(url.hostname) && config.articlePath.test(url.pathname);
  } catch {
    return false;
  }
}

function dedupeFeedItems(items: FeedItem[]): FeedItem[] {
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  return items.filter((item) => {
    const idKey = `${item.source}:${item.id}`;
    const urlKey = normalizeUrl(item.originalUrl);
    if (seenIds.has(idKey) || seenUrls.has(urlKey)) return false;
    seenIds.add(idKey);
    seenUrls.add(urlKey);
    return true;
  });
}

function crossSourceCoverageBonus(item: FeedItem, allItems: FeedItem[]): number {
  const tokens = titleTokens(item.title);
  if (tokens.size < 2) return 0;
  return allItems.some((other) => other.source !== item.source && sameDay(other.publishedAt, item.publishedAt) && overlap(tokens, titleTokens(other.title)) >= 2) ? 8 : 0;
}

function titleTokens(title: string): Set<string> {
  return new Set(title.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 3 && !["with", "from", "that", "this", "after", "into", "says"].includes(token)));
}

function overlap(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const token of left) if (right.has(token)) count += 1;
  return count;
}

function sameDay(left: string, right: string): boolean { return left.slice(0, 10) === right.slice(0, 10); }

function scoreFeedItem(item: FeedItem, now: Date): number {
  const text = `${item.title} ${item.summary} ${item.category}`.toLowerCase();
  let score = 0;
  const ageHours = Math.max(0, (now.getTime() - Date.parse(item.publishedAt)) / 3_600_000);
  score += Math.max(0, 40 - ageHours);
  if (/world|international|global|business|econom|technology|science|climate|culture|united nations|diplom/.test(text)) score += 25;
  if (/uk|britain|england|scotland|wales|county|mayor|council|local|regional|police|football|sport/.test(text)) score -= 12;
  if (item.summary.length > 80) score += 5;
  if (item.imageUrl) score += 2;
  return score;
}

function isRecent(value: string, now: Date): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= now.getTime() - FIVE_DAYS_MS && timestamp <= now.getTime();
}

function textContent(root: Element, selector: string): string { return root.querySelector(selector)?.textContent?.trim() ?? ""; }

function stripMarkup(value: string): string {
  const container = document.createElement("div");
  container.innerHTML = value;
  return container.textContent?.trim() ?? "";
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    [...url.searchParams.keys()].filter((key) => TRACKING_PARAMS.test(key)).forEach((key) => url.searchParams.delete(key));
    url.hash = "";
    return url.href;
  } catch { return value.trim(); }
}

function normalizeOptionalUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try { return new URL(value).href; } catch { return undefined; }
}

function idPart(value: string): string {
  const clean = value.split("/").filter(Boolean).at(-1)?.replace(/[^a-zA-Z0-9_-]/g, "") || "item";
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `${clean.slice(0, 48)}-${hash.toString(36)}`;
}

function defaultCategory(source: ExternalArticleSource): string {
  return source === "un-news" ? "UN News"
    : source === "voa" ? "VOA News"
      : source === "cgtn" ? "CGTN"
        : source === "bbc" ? "BBC News"
          : source === "rest-of-world" ? "Rest of World"
            : source === "aeon" ? "Aeon"
              : source === "quanta" ? "Quanta Magazine"
                : source === "works-in-progress" ? "Works in Progress"
                  : "News";
}

function meta(document: Document, property: string): string {
  return document.querySelector(`meta[property="${property}"], meta[name="${property}"]`)?.getAttribute("content")?.trim() ?? "";
}

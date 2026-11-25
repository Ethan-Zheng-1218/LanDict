import type { FeedItem } from "./feedItem";
import { usesDesktopBackend } from "../translation/dictionaryProvider";
import { fetchDesktopReadingSource } from "./readingTransport";

export type BbcFeedItem = FeedItem;

export type BbcFetch = (input: string, init?: RequestInit) => Promise<Response>;

export const BBC_FEED_URL = "https://feeds.bbci.co.uk/news/world/rss.xml";
const BBC_FEED_PROXY_URL = "/api/bbc-feed";
const BBC_HOSTS = new Set(["bbc.com", "www.bbc.com", "bbc.co.uk", "www.bbc.co.uk"]);

const defaultFetcher: BbcFetch = (input, init) => {
  if (typeof window !== "undefined" && usesDesktopBackend() && (input === BBC_FEED_URL || isBbcArticleUrl(input))) {
    return fetchDesktopReadingSource("bbc", input, init?.signal ?? undefined);
  }
  if (typeof window !== "undefined" && input === BBC_FEED_URL) return fetch(BBC_FEED_PROXY_URL, init);
  if (typeof window !== "undefined" && isBbcArticleUrl(input)) return fetch(`/api/bbc-article?url=${encodeURIComponent(input)}`, init);
  return fetch(input, init);
};

export async function fetchBbcFeed(fetcher: BbcFetch = defaultFetcher, now = new Date()): Promise<BbcFeedItem[]> {
  const response = await fetcher(BBC_FEED_URL);
  if (!response.ok) throw new Error("BBC feed request failed");
  const body = await response.text();
  if (response.headers?.get("content-type")?.includes("application/json") || body.trimStart().startsWith("{")) {
    return parseBbcFeedJson(JSON.parse(body), now);
  }
  return parseBbcFeed(body, now);
}

export async function fetchBbcArticle(url: string, fetcher: BbcFetch = defaultFetcher): Promise<string> {
  const parsed = new URL(url);
  if (!BBC_HOSTS.has(parsed.hostname) || !parsed.pathname.startsWith("/news/")) throw new Error("Unsupported BBC article URL");
  const response = await fetcher(url);
  if (!response.ok) throw new Error("BBC article request failed");
  return response.text();
}

export function parseBbcFeed(xml: string, now = new Date()): BbcFeedItem[] {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("BBC feed XML is invalid");
  const cutoff = now.getTime() - 5 * 24 * 60 * 60 * 1000;
  return [...document.querySelectorAll("item")].flatMap((item) => {
    const title = textContent(item, "title");
    const originalUrl = textContent(item, "link");
    const publishedAt = textContent(item, "pubDate");
    const timestamp = Date.parse(publishedAt);
    if (!title || !originalUrl || !Number.isFinite(timestamp) || timestamp < cutoff || timestamp > now.getTime()) return [];
    try {
      const url = new URL(originalUrl);
      if (!BBC_HOSTS.has(url.hostname) || !url.pathname.startsWith("/news/")) return [];
      const idSource = textContent(item, "guid") || url.pathname.split("/").filter(Boolean).at(-1) || url.pathname;
      const imageUrl = [...item.querySelectorAll("*")].find((element) => element.localName === "thumbnail" || element.localName === "content")?.getAttribute("url") ?? undefined;
      return [{
        id: `bbc-${idSource.split("/").filter(Boolean).at(-1)?.replace(/[^a-zA-Z0-9_-]/g, "") || hashId(originalUrl)}`,
        source: "bbc" as const,
        title,
        summary: stripMarkup(textContent(item, "description")),
        originalUrl,
        publishedAt: new Date(timestamp).toISOString(),
        category: textContent(item, "category") || "BBC News",
        imageUrl,
        downloaded: false,
      } satisfies BbcFeedItem];
    } catch {
      return [];
    }
  });
}

export function parseBbcFeedJson(value: unknown, now = new Date()): BbcFeedItem[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { items?: unknown }).items)) {
    throw new Error("BBC feed JSON is invalid");
  }
  const cutoff = now.getTime() - 5 * 24 * 60 * 60 * 1000;
  return (value as { items: unknown[] }).items.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const originalUrl = typeof item.link === "string" ? item.link.trim() : "";
    const publishedAt = typeof item.pubDate === "string" ? item.pubDate.trim() : "";
    const timestamp = Date.parse(publishedAt);
    if (!title || !originalUrl || !Number.isFinite(timestamp) || timestamp < cutoff || timestamp > now.getTime()) return [];
    try {
      const url = new URL(originalUrl);
      if (!BBC_HOSTS.has(url.hostname) || !url.pathname.startsWith("/news/")) return [];
      const idSource = typeof item.guid === "string" && item.guid ? item.guid : url.pathname;
      const summary = typeof item.description === "string" ? stripMarkup(item.description) : "";
      const imageUrl = typeof item.thumbnail === "string" && item.thumbnail ? item.thumbnail : undefined;
      return [{
        id: `bbc-${idSource.split("/").filter(Boolean).at(-1)?.replace(/[^a-zA-Z0-9_-]/g, "") || hashId(originalUrl)}`,
        source: "bbc" as const,
        title,
        summary,
        originalUrl,
        publishedAt: new Date(timestamp).toISOString(),
        category: "BBC News",
        imageUrl,
        downloaded: false,
      } satisfies BbcFeedItem];
    } catch {
      return [];
    }
  });
}

function textContent(root: Element, selector: string): string {
  return root.querySelector(selector)?.textContent?.trim() ?? "";
}

function isBbcArticleUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    return BBC_HOSTS.has(parsed.hostname) && parsed.pathname.startsWith("/news/");
  } catch {
    return false;
  }
}

function stripMarkup(value: string): string {
  const container = document.createElement("div");
  container.innerHTML = value;
  return container.textContent?.trim() ?? "";
}

function hashId(value: string): string {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash.toString(36);
}

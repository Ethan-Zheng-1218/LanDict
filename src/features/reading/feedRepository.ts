import { readStored, writeStored } from "../../lib/browserStorage";
import type { FeedItem } from "./feedItem";
import { fetchAllSourceFeeds, selectTopFeedItems, SOURCE_ENDPOINTS, type ExternalArticleSource } from "./newsSources";

export const FEED_STORAGE_KEY = "landict.reading.feed.v1";
export const FEED_CHANGED_EVENT = "landict:reading-feed-changed";
const REFRESH_SESSION_KEY = "landict.reading.feed-refreshed";

const isFeedItem = (value: unknown): value is FeedItem => {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<FeedItem>;
  return typeof item.id === "string" && ["bbc", "cgtn", "voa", "un-news", "rest-of-world", "aeon", "quanta", "works-in-progress"].includes(item.source ?? "") && typeof item.title === "string"
    && typeof item.summary === "string" && typeof item.originalUrl === "string"
    && typeof item.publishedAt === "string" && typeof item.category === "string"
    && (item.contentType === undefined || item.contentType === "news" || item.contentType === "article")
    && typeof item.downloaded === "boolean"
    && (item.imageUrl === undefined || typeof item.imageUrl === "string")
    && (item.localArticleId === undefined || typeof item.localArticleId === "string");
};

const isFeedItemList = (value: unknown): value is FeedItem[] => Array.isArray(value) && value.every(isFeedItem);
type FeedRefreshOptions = { loader?: () => Promise<FeedItem[] | { items: FeedItem[]; successfulSources: ExternalArticleSource[] }>; now?: Date };
type FeedRefreshResult = { items: FeedItem[]; partial: boolean };
let refreshPromise: Promise<FeedRefreshResult> | undefined;

export function listFeedItems(): FeedItem[] {
  return readStored(FEED_STORAGE_KEY, [], isFeedItemList).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function saveFeedItems(items: FeedItem[]): FeedItem[] {
  const normalized = items.filter(isFeedItem).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  writeStored(FEED_STORAGE_KEY, normalized);
  window.dispatchEvent(new CustomEvent(FEED_CHANGED_EVENT));
  return normalized;
}

export function updateFeedItem(itemId: string, patch: Partial<FeedItem>): FeedItem | undefined {
  const item = listFeedItems().find((candidate) => candidate.id === itemId);
  if (!item) return undefined;
  const updated = { ...item, ...patch };
  saveFeedItems(listFeedItems().map((candidate) => candidate.id === itemId ? updated : candidate));
  return updated;
}

export function clearExpiredFeedItems(now = new Date()): void {
  const cutoff = now.getTime() - 5 * 24 * 60 * 60 * 1000;
  saveFeedItems(listFeedItems().filter((item) => item.downloaded || Date.parse(item.publishedAt) >= cutoff));
}

export async function refreshReadingFeedOnce(options: FeedRefreshOptions = {}): Promise<FeedItem[]> {
  if (refreshPromise) return refreshPromise.then((result) => result.items).catch(() => listFeedItems());
  if (window.sessionStorage.getItem(REFRESH_SESSION_KEY) === "1") return listFeedItems();
  window.sessionStorage.setItem(REFRESH_SESSION_KEY, "1");
  return refreshReadingFeed(options).then((result) => result.items).catch(() => listFeedItems());
}

/** Manual refresh bypasses the session guard; only requests still in flight are shared. */
export async function refreshReadingFeed(options: FeedRefreshOptions = {}): Promise<FeedRefreshResult> {
  if (refreshPromise) return refreshPromise;
  const now = options.now ?? new Date();
  const loader = options.loader ?? (() => fetchAllSourceFeeds(undefined, now));
  refreshPromise = Promise.resolve().then(loader)
    .then((result) => {
      const fresh = Array.isArray(result) ? result : result.items;
      const successfulSources = new Set<ExternalArticleSource>(Array.isArray(result) ? [...new Set(fresh.map((item) => item.source))] : result.successfulSources);
      if (!Array.isArray(result) && !successfulSources.size) throw new Error("No reading sources available");
      const previous = listFeedItems();
      const previousByKey = new Map(previous.map((item) => [`${item.source}:${item.id}`, item]));
      const previousByUrl = new Map(previous.map((item) => [`${item.source}:${normalizeFeedUrl(item.originalUrl)}`, item]));
      const merged = fresh.map((item) => {
        const previousItem = previousByKey.get(`${item.source}:${item.id}`) ?? previousByUrl.get(`${item.source}:${normalizeFeedUrl(item.originalUrl)}`);
        return { ...item, downloaded: previousItem?.downloaded ?? item.downloaded, localArticleId: previousItem?.localArticleId ?? item.localArticleId };
      });
      clearExpiredFeedItems(now);
      const retained = listFeedItems().filter((item) => (!successfulSources.has(item.source) || item.downloaded) && !merged.some((freshItem) => freshItem.source === item.source && freshItem.id === item.id));
      return {
        items: saveFeedItems(selectTopFeedItems([...merged, ...retained], now)),
        partial: !Array.isArray(result) && successfulSources.size < Object.keys(SOURCE_ENDPOINTS).length,
      };
    })
    .finally(() => { refreshPromise = undefined; });
  return refreshPromise;
}

/** Backward-compatible name for callers that still use the old BBC-only entry point. */
export const refreshBbcFeedOnce = refreshReadingFeedOnce;

export function resetFeedRefreshForTests(): void {
  refreshPromise = undefined;
  window.sessionStorage.removeItem(REFRESH_SESSION_KEY);
}

function normalizeFeedUrl(value: string): string {
  try {
    const url = new URL(value);
    [...url.searchParams.keys()].filter((key) => /^utm_|^ref$|^at_/i.test(key)).forEach((key) => url.searchParams.delete(key));
    url.hash = "";
    return url.href;
  } catch { return value; }
}

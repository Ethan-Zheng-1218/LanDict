import { readStored, writeStored } from "@/lib/browserStorage";
import { getArticleDocument } from "./articleRepository";
import { listReadingRecords, READING_ARTICLE_ID } from "./readingStore";

type ReadingPosition = {
  pathname: "/reading" | "/reading/article";
  search: string;
  state: Record<string, unknown> | null;
  scrollTop?: number;
};

const STORAGE_KEY = "landict.reading.position.v1";

export function getReadingPosition(): ReadingPosition {
  const saved = readStored<ReadingPosition | null>(STORAGE_KEY, null, (value): value is ReadingPosition | null => {
    if (!value || typeof value !== "object") return false;
    const position = value as Partial<ReadingPosition>;
    return (position.pathname === "/reading" || position.pathname === "/reading/article")
      && typeof position.search === "string" && typeof position.scrollTop === "number"
      && Number.isFinite(position.scrollTop) && position.scrollTop >= 0
      && (position.state === null || typeof position.state === "object");
  });
  if (saved) return saved;
  // Older installations already have progress, but no navigation bookmark yet.
  const unfinished = listReadingRecords().find((record) => !record.completed
    && (record.articleId === READING_ARTICLE_ID || getArticleDocument(record.articleId)));
  return unfinished
    ? { pathname: "/reading/article", search: `?id=${encodeURIComponent(unfinished.articleId)}`, state: null }
    : { pathname: "/reading", search: "", state: null };
}

export function saveReadingPosition(position: ReadingPosition) {
  writeStored(STORAGE_KEY, position);
}

export function getResumeScrollTop(state: unknown): number | undefined {
  const value = state && typeof state === "object" && "readingScrollTop" in state ? state.readingScrollTop : undefined;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

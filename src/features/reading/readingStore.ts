import { dispatchStorageEvent, readStored, writeStored } from "../../lib/browserStorage";

export const READING_STORAGE_KEY = "landict.reading.v1";
export const READING_CHANGED_EVENT = "landict:reading-changed";
export const READING_ARTICLE_ID = "global-push-clean-energy";

export type ReadingAnnotation = {
  id: string;
  start: number;
  end: number;
  quote: string;
  kind: "highlight" | "note";
  color?: "yellow" | "green" | "pink" | "cyan";
  note?: string;
  createdAt: number;
};

export type ReadingRecord = {
  articleId: string;
  title: string;
  progress: number;
  lastReadAt: string;
  completed: boolean;
  favorite?: boolean;
  annotations: ReadingAnnotation[];
  queriedWords?: string[];
};

export const isReadingAnnotation = (value: unknown): value is ReadingAnnotation => {
  if (!value || typeof value !== "object") return false;
  const annotation = value as Partial<ReadingAnnotation>;
  const start = annotation.start;
  const end = annotation.end;
  return typeof annotation.id === "string" && typeof start === "number" && typeof end === "number"
    && Number.isInteger(start) && Number.isInteger(end) && end > start && typeof annotation.quote === "string"
    && (annotation.kind === "highlight" || annotation.kind === "note") && typeof annotation.createdAt === "number"
    && (annotation.kind === "highlight" ? ["yellow", "green", "pink", "cyan"].includes(annotation.color ?? "") : typeof annotation.note === "string");
};

const isReadingRecord = (value: unknown): value is ReadingRecord => {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ReadingRecord>;
  return typeof record.articleId === "string" && typeof record.title === "string"
    && typeof record.progress === "number" && record.progress >= 0 && record.progress <= 100
    && typeof record.lastReadAt === "string" && typeof record.completed === "boolean"
    && (record.favorite === undefined || typeof record.favorite === "boolean")
    && Array.isArray(record.annotations) && record.annotations.every(isReadingAnnotation)
    && (record.queriedWords === undefined || (Array.isArray(record.queriedWords) && record.queriedWords.every((word) => typeof word === "string")));
};

const isReadingRecordList = (value: unknown): value is ReadingRecord[] => Array.isArray(value) && value.every(isReadingRecord);

export function listReadingRecords(): ReadingRecord[] {
  return readStored(READING_STORAGE_KEY, [], isReadingRecordList).sort((a, b) => b.lastReadAt.localeCompare(a.lastReadAt));
}

export function getReadingRecord(articleId: string): ReadingRecord | undefined {
  return listReadingRecords().find((record) => record.articleId === articleId);
}

function persist(records: ReadingRecord[]) {
  writeStored(READING_STORAGE_KEY, records);
  dispatchStorageEvent(READING_CHANGED_EVENT);
}

function upsertRecord(articleId: string, changes: Partial<ReadingRecord>): ReadingRecord {
  const records = listReadingRecords();
  const index = records.findIndex((record) => record.articleId === articleId);
  const existing = index >= 0 ? records[index] : undefined;
  const record: ReadingRecord = {
    articleId,
    title: changes.title ?? existing?.title ?? "",
    progress: changes.progress ?? existing?.progress ?? 0,
    lastReadAt: changes.lastReadAt ?? new Date().toISOString(),
    completed: changes.completed ?? existing?.completed ?? false,
    favorite: changes.favorite ?? existing?.favorite ?? false,
    annotations: changes.annotations ?? existing?.annotations ?? [],
    queriedWords: changes.queriedWords ?? existing?.queriedWords ?? [],
  };
  if (index >= 0) records[index] = record;
  else records.push(record);
  persist(records);
  return record;
}

export function updateReadingProgress(articleId: string, progress: number, title?: string): ReadingRecord {
  const normalized = Math.min(100, Math.max(0, Math.round(progress)));
  return upsertRecord(articleId, { progress: normalized, completed: normalized >= 100, title, lastReadAt: new Date().toISOString() });
}

export function updateReadingFavorite(articleId: string, favorite: boolean, title?: string): ReadingRecord {
  return upsertRecord(articleId, { favorite, title, lastReadAt: new Date().toISOString() });
}

export function saveReadingAnnotations(articleId: string, annotations: ReadingAnnotation[], title?: string): ReadingRecord {
  return upsertRecord(articleId, { annotations, title, lastReadAt: new Date().toISOString() });
}

export function addReadingAnnotation(articleId: string, annotation: ReadingAnnotation, title?: string): ReadingAnnotation {
  const current = getReadingRecord(articleId);
  saveReadingAnnotations(articleId, [...(current?.annotations ?? []).filter((item) => item.id !== annotation.id), annotation], title);
  return annotation;
}

export function removeReadingAnnotation(articleId: string, annotationId: string): void {
  const current = getReadingRecord(articleId);
  if (!current) return;
  saveReadingAnnotations(articleId, current.annotations.filter((annotation) => annotation.id !== annotationId), current.title);
}

export function recordReadingWordQuery(articleId: string, word: string, title?: string): ReadingRecord {
  const normalized = word.trim().toLowerCase();
  const current = getReadingRecord(articleId);
  if (!normalized) return current ?? upsertRecord(articleId, { title });
  const queriedWords = current?.queriedWords ?? [];
  if (queriedWords.includes(normalized)) return current ?? upsertRecord(articleId, { title, queriedWords });
  return upsertRecord(articleId, { title, queriedWords: [...queriedWords, normalized], lastReadAt: new Date().toISOString() });
}

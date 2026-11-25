import { dispatchStorageEvent, readStored, writeStored } from "../../lib/browserStorage";

export const HISTORY_STORAGE_KEY = "landict.history.v1";
export const HISTORY_CHANGED_EVENT = "landict:history-changed";
export const HISTORY_LIMIT = 30;

export type HistoryKind = "word" | "phrase" | "text";
export type HistoryEntry = {
  id: string;
  query: string;
  kind: HistoryKind;
  source: string;
  preview?: string;
  createdAt: string;
};
export type NewHistoryEntry = Pick<HistoryEntry, "query" | "kind" | "source"> & Partial<Pick<HistoryEntry, "preview">>;

const normalizeQuery = (query: string) => query.trim().toLowerCase();
const isHistoryKind = (value: unknown): value is HistoryKind => value === "word" || value === "phrase" || value === "text";
const isHistoryEntry = (value: unknown): value is HistoryEntry => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<HistoryEntry>;
  return typeof entry.id === "string" && typeof entry.query === "string" && isHistoryKind(entry.kind)
    && typeof entry.source === "string" && (entry.preview === undefined || typeof entry.preview === "string")
    && typeof entry.createdAt === "string";
};
const isHistoryList = (value: unknown): value is HistoryEntry[] => Array.isArray(value) && value.every(isHistoryEntry);

export function listHistory(): HistoryEntry[] {
  return readStored(HISTORY_STORAGE_KEY, [], isHistoryList);
}

export function addHistory(input: NewHistoryEntry): HistoryEntry {
  const query = normalizeQuery(input.query);
  if (!query) throw new Error("查询内容不能为空");
  const entries = listHistory();
  const now = new Date().toISOString();
  const existing = entries.find((entry) => entry.query === query);
  const entry: HistoryEntry = existing
    ? { ...existing, kind: input.kind, source: input.source, ...(input.preview ? { preview: input.preview.trim() } : {}), createdAt: now }
    : { id: `history-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, query, kind: input.kind, source: input.source, ...(input.preview ? { preview: input.preview.trim() } : {}), createdAt: now };
  const next = [entry, ...entries.filter((item) => item.id !== existing?.id)].slice(0, HISTORY_LIMIT);
  writeStored(HISTORY_STORAGE_KEY, next);
  dispatchStorageEvent(HISTORY_CHANGED_EVENT);
  return entry;
}

export function updateHistoryPreview(query: string, preview: string): void {
  const normalizedQuery = normalizeQuery(query);
  const normalizedPreview = preview.trim();
  if (!normalizedQuery || !normalizedPreview) return;
  const entries = listHistory();
  let changed = false;
  const next = entries.map((entry) => {
    if (entry.query !== normalizedQuery || entry.preview === normalizedPreview) return entry;
    changed = true;
    return { ...entry, preview: normalizedPreview };
  });
  if (!changed) return;
  writeStored(HISTORY_STORAGE_KEY, next);
  dispatchStorageEvent(HISTORY_CHANGED_EVENT);
}

export function clearHistory(): void {
  writeStored(HISTORY_STORAGE_KEY, []);
  dispatchStorageEvent(HISTORY_CHANGED_EVENT);
}

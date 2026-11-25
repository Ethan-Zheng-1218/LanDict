import { useCallback, useEffect, useState } from "react";
import { dispatchStorageEvent, readStored, writeStored } from "../../lib/browserStorage";

export const VOCABULARY_STORAGE_KEY = "landict.vocabulary.v1";
export const VOCABULARY_CHANGED_EVENT = "landict:vocabulary-changed";

/* Study progress: every collected word starts as "pending" and moves forward by hand. */
export type VocabularyStatus = "pending" | "learning" | "mastered";
export type VocabularySourceType = "lookup" | "reading" | "import";
export type VocabularyExample = { partOfSpeech: string; text: string; translation?: string };
export type VocabularyEntry = {
  id: string; word: string; phonetic: string; britishPhonetic: string; americanPhonetic: string;
  meaning: string; definition: string; partOfSpeech: string; collocations: string[]; collocationTranslations?: Record<string, string>; examples?: VocabularyExample[]; example: string; source: string;
  sourceType: VocabularySourceType; status: VocabularyStatus; note: string; createdAt: string; updatedAt: string;
  /** Restored content stays intact instead of being replaced by background dictionary enrichment. */
  restoredFromBackup?: boolean;
};
export type NewVocabularyEntry = Pick<VocabularyEntry, "word" | "meaning" | "source" | "sourceType"> & Partial<Pick<VocabularyEntry, "status" | "phonetic" | "britishPhonetic" | "americanPhonetic" | "definition" | "partOfSpeech" | "collocations" | "collocationTranslations" | "examples" | "example" | "note" | "createdAt" | "updatedAt" | "restoredFromBackup">>;

export const VOCABULARY_STATUS_LABELS: Record<VocabularyStatus, string> = {
  pending: "待学习",
  learning: "学习中",
  mastered: "已掌握",
};

const LEGACY_STATUS: Record<string, VocabularyStatus> = { new: "pending", learning: "learning", familiar: "mastered" };

export const normalizeVocabularyWord = (word: string) => word.trim().toLowerCase();

function isVocabularyEntry(value: unknown): value is VocabularyEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<VocabularyEntry>;
  return typeof entry.id === "string" && typeof entry.word === "string" && typeof entry.meaning === "string";
}

function normalizeStatus(value: unknown, legacy: unknown): VocabularyStatus {
  if (value === "pending" || value === "learning" || value === "mastered") return value;
  if (typeof legacy === "string" && LEGACY_STATUS[legacy]) return LEGACY_STATUS[legacy];
  return "pending";
}

function normalizeSourceType(value: unknown): VocabularySourceType {
  if (value === "reading" || value === "import") return value;
  return "lookup";
}

function normalizeVocabularyEntry(entry: Partial<VocabularyEntry>): VocabularyEntry {
  const now = new Date().toISOString();
  const legacy = (entry as { familiarity?: unknown }).familiarity;
  return {
    id: entry.id ?? `legacy-${Date.now().toString(36)}`,
    word: normalizeVocabularyWord(entry.word ?? ""),
    phonetic: entry.phonetic ?? entry.britishPhonetic ?? "",
    britishPhonetic: entry.britishPhonetic ?? entry.phonetic ?? "",
    americanPhonetic: entry.americanPhonetic ?? entry.phonetic ?? "",
    meaning: entry.meaning ?? "",
    definition: entry.definition ?? "",
    partOfSpeech: entry.partOfSpeech ?? "",
    collocations: Array.isArray(entry.collocations) ? entry.collocations.filter((item): item is string => typeof item === "string") : [],
    collocationTranslations: entry.collocationTranslations ?? {},
    examples: Array.isArray(entry.examples) ? entry.examples.filter((item): item is VocabularyExample => Boolean(item && typeof item === "object" && typeof item.partOfSpeech === "string" && typeof item.text === "string")) : [],
    example: entry.example ?? "",
    source: entry.source ?? "未知来源",
    sourceType: normalizeSourceType(entry.sourceType),
    status: normalizeStatus(entry.status, legacy),
    note: entry.note ?? "",
    createdAt: entry.createdAt ?? now,
    updatedAt: entry.updatedAt ?? now,
    ...(entry.restoredFromBackup === true ? { restoredFromBackup: true } : {}),
  };
}

export function listVocabulary(): VocabularyEntry[] {
  return readStored(VOCABULARY_STORAGE_KEY, [], (value): value is VocabularyEntry[] => Array.isArray(value) && value.every(isVocabularyEntry)).map(normalizeVocabularyEntry);
}

function persist(entries: VocabularyEntry[]) {
  writeStored(VOCABULARY_STORAGE_KEY, entries);
  dispatchStorageEvent(VOCABULARY_CHANGED_EVENT);
}

function createEntry(input: NewVocabularyEntry, index: number, now: string): VocabularyEntry {
  const word = normalizeVocabularyWord(input.word);
  return {
    id: `${word}-${Date.now().toString(36)}-${index}`,
    word,
    phonetic: input.phonetic ?? input.britishPhonetic ?? "",
    britishPhonetic: input.britishPhonetic ?? input.phonetic ?? "",
    americanPhonetic: input.americanPhonetic ?? input.phonetic ?? "",
    meaning: input.meaning,
    definition: input.definition ?? "",
    partOfSpeech: input.partOfSpeech ?? "",
    collocations: input.collocations ?? [],
    collocationTranslations: input.collocationTranslations ?? {},
    examples: input.examples ?? [],
    example: input.example ?? "",
    source: input.source,
    sourceType: input.sourceType,
    status: input.status ?? "pending",
    note: input.note ?? "",
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    ...(input.restoredFromBackup === true ? { restoredFromBackup: true } : {}),
  };
}

export function saveVocabulary(input: NewVocabularyEntry): VocabularyEntry {
  const entries = listVocabulary();
  const normalized = normalizeVocabularyWord(input.word);
  const now = new Date().toISOString();
  const index = entries.findIndex((entry) => normalizeVocabularyWord(entry.word) === normalized);
  if (index >= 0) {
    const existing = entries[index];
    const updated = normalizeVocabularyEntry({
      ...existing,
      ...input,
      word: normalized,
      phonetic: input.phonetic ?? existing.phonetic,
      britishPhonetic: input.britishPhonetic ?? existing.britishPhonetic,
      americanPhonetic: input.americanPhonetic ?? existing.americanPhonetic,
      example: input.example ?? existing.example,
      definition: input.definition ?? existing.definition,
      partOfSpeech: input.partOfSpeech ?? existing.partOfSpeech,
      collocations: input.collocations ?? existing.collocations,
      collocationTranslations: input.collocationTranslations ?? existing.collocationTranslations,
      examples: input.examples ?? existing.examples,
      status: input.status ?? existing.status,
      updatedAt: now,
    });
    entries[index] = updated;
    persist(entries);
    return updated;
  }
  const entry = createEntry(input, 0, now);
  persist([entry, ...entries]);
  return entry;
}

/* Bulk insert for the import dialog: existing words are skipped, never overwritten. */
export function addVocabularyEntries(inputs: NewVocabularyEntry[]): { added: number; skipped: number } {
  const entries = listVocabulary();
  const known = new Set(entries.map((entry) => normalizeVocabularyWord(entry.word)));
  const now = new Date().toISOString();
  const added: VocabularyEntry[] = [];
  let skipped = 0;
  inputs.forEach((input, index) => {
    const word = normalizeVocabularyWord(input.word);
    if (!word || known.has(word)) {
      skipped += 1;
      return;
    }
    known.add(word);
    added.push(createEntry({ ...input, word }, index, now));
  });
  if (added.length) persist([...added, ...entries]);
  return { added: added.length, skipped };
}

export function updateVocabulary(id: string, changes: Partial<Pick<VocabularyEntry, "status" | "note">>) {
  const entries = listVocabulary();
  const index = entries.findIndex((entry) => entry.id === id);
  if (index < 0) return undefined;
  entries[index] = { ...entries[index], ...changes, updatedAt: new Date().toISOString() };
  persist(entries);
  return entries[index];
}

export function updateVocabularyPronunciation(id: string, pronunciation: Pick<VocabularyEntry, "phonetic" | "britishPhonetic" | "americanPhonetic">) {
  const entries = listVocabulary();
  const index = entries.findIndex((entry) => entry.id === id);
  if (index < 0) return undefined;
  entries[index] = { ...entries[index], ...pronunciation, updatedAt: new Date().toISOString() };
  persist(entries);
  return entries[index];
}

export function removeVocabulary(idOrWord: string) {
  const normalized = normalizeVocabularyWord(idOrWord);
  persist(listVocabulary().filter((entry) => entry.id !== idOrWord && normalizeVocabularyWord(entry.word) !== normalized));
}

/* Re-insert a removed entry at its old list position when the undo toast is used. */
export function restoreVocabulary(entry: VocabularyEntry, index: number) {
  const entries = listVocabulary();
  entries.splice(Math.min(Math.max(index, 0), entries.length), 0, entry);
  persist(entries);
}

export function useVocabulary() {
  const [entries, setEntries] = useState<VocabularyEntry[]>(() => listVocabulary());
  const refresh = useCallback(() => setEntries(listVocabulary()), []);
  useEffect(() => {
    window.addEventListener(VOCABULARY_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(VOCABULARY_CHANGED_EVENT, refresh); window.removeEventListener("storage", refresh); };
  }, [refresh]);
  return entries;
}

import { normalizeVocabularyWord, type NewVocabularyEntry } from "./vocabularyStore";
import { MAX_VOCABULARY_FILE_BYTES, readVocabularyBackup } from "./vocabularyBackup";

export const IMPORT_MISSING_MEANING = "待补充释义";
export const IMPORT_SOURCE_LABEL = "导入";
export const MAX_IMPORT_BYTES = MAX_VOCABULARY_FILE_BYTES;

export type ImportedVocabularyItem = Pick<NewVocabularyEntry, "word" | "meaning"> & Partial<Omit<NewVocabularyEntry, "word" | "meaning">>;
export type VocabularyImportFormat = "json" | "text" | "session-log" | "empty" | "backup" | "unsupported-backup" | "invalid-backup" | "invalid-json";
export type VocabularyImportResult = {
  format: VocabularyImportFormat;
  rowCount: number;
  items: ImportedVocabularyItem[];
  duplicateCount: number;
  missingMeaningCount: number;
};

const WORD_KEYS = ["word", "term", "text", "phrase", "headword", "vocabulary", "english", "en"];
const MEANING_KEYS = ["meaning", "definition", "translation", "chinese", "meaningCn", "translationCn", "explain", "cn"];
const LIST_KEYS = ["words", "vocabulary", "items", "wordList", "terms", "entries", "list", "data"];
const HEADER_LABELS = new Set(["word", "words", "term", "headword", "english", "单词", "词汇", "生词", "英文", "短语", "序号", "no", "no."]);

function pick(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/* "apple苹果" pasted as one cell: keep the English headword, reuse the Chinese tail as the meaning. */
function splitWordCell(cell: string): { word: string; meaning: string } {
  const text = cell.trim();
  const cjkIndex = text.search(/[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/);
  if (cjkIndex > 0) return { word: text.slice(0, cjkIndex).trim(), meaning: text.slice(cjkIndex).trim() };
  return { word: text, meaning: "" };
}

function looksLikeWord(word: string): boolean {
  if (!/^[a-z][a-z'’\-. ]*$/i.test(word)) return false;
  if (word.replace(/[^a-z]/gi, "").length === 0) return false;
  return word.length <= 48 && word.split(/\s+/).length <= 6;
}

function detectDelimiter(line: string): string {
  if (line.includes("\t")) return "\t";
  if (line.includes("|")) return "|";
  if (line.includes(";") && !line.includes(",")) return ";";
  return ",";
}

function splitCells(line: string): string[] {
  const delimiter = detectDelimiter(line);
  const cells: string[] = [];
  let buffer = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        buffer += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      cells.push(buffer);
      buffer = "";
    } else {
      buffer += character;
    }
  }
  cells.push(buffer);
  return cells.map((cell) => cell.trim());
}

function textRows(text: string): string[][] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(splitCells);
}

function jsonList(parsed: unknown): unknown[] | undefined {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    for (const key of LIST_KEYS) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  return undefined;
}

function jsonRow(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [pick(record, WORD_KEYS), pick(record, MEANING_KEYS)];
}

/* PuDict English Companion exports whole chat sessions; that file is not a word list. */
function isSessionLog(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object") return false;
  const sessions = (parsed as Record<string, unknown>).sessions;
  if (!Array.isArray(sessions) || sessions.length === 0) return false;
  return sessions.every((session) => Boolean(session && typeof session === "object" && Array.isArray((session as Record<string, unknown>).messages)));
}

function collect(rows: string[][], known: Set<string>, format: VocabularyImportFormat): VocabularyImportResult {
  const items: ImportedVocabularyItem[] = [];
  let duplicateCount = 0;
  let missingMeaningCount = 0;
  rows.forEach((cells) => {
    const first = (cells[0] ?? "").trim();
    if (!first || HEADER_LABELS.has(first.toLowerCase())) return;
    const split = splitWordCell(first);
    const rest = cells.slice(1).map((cell) => cell.trim()).filter(Boolean).join("；");
    const word = split.word.trim();
    if (!looksLikeWord(word)) return;
    const key = normalizeVocabularyWord(word);
    if (known.has(key)) {
      duplicateCount += 1;
      return;
    }
    known.add(key);
    const meaning = [split.meaning, rest].filter(Boolean).join("；");
    if (!meaning) missingMeaningCount += 1;
    items.push({ word, meaning: meaning || IMPORT_MISSING_MEANING });
  });
  return { format, rowCount: rows.length, items, duplicateCount, missingMeaningCount };
}

export function parseVocabularyImport(raw: string, existingWords: string[] = []): VocabularyImportResult {
  const empty: VocabularyImportResult = { format: "empty", rowCount: 0, items: [], duplicateCount: 0, missingMeaningCount: 0 };
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (!text) return empty;
  const known = new Set(existingWords.map((word) => normalizeVocabularyWord(word)).filter(Boolean));
  if (text.startsWith("{") || text.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ...empty, format: "invalid-json" };
    }
    const backup = readVocabularyBackup(parsed);
    if (backup) {
      const items: ImportedVocabularyItem[] = [];
      let duplicateCount = 0;
      for (const entry of backup.entries) {
        const key = normalizeVocabularyWord(entry.word);
        if (known.has(key)) { duplicateCount += 1; continue; }
        known.add(key);
        // IDs belong to the destination computer; preserve only the validated vocabulary fields.
        items.push({
          word: entry.word, meaning: entry.meaning, phonetic: entry.phonetic, britishPhonetic: entry.britishPhonetic,
          americanPhonetic: entry.americanPhonetic, definition: entry.definition, partOfSpeech: entry.partOfSpeech,
          collocations: entry.collocations, collocationTranslations: entry.collocationTranslations, examples: entry.examples,
          example: entry.example, source: entry.source, sourceType: entry.sourceType, status: entry.status,
          note: entry.note, createdAt: entry.createdAt, updatedAt: entry.updatedAt, restoredFromBackup: true,
        });
      }
      return { format: backup.format, rowCount: backup.entries.length, items, duplicateCount, missingMeaningCount: 0 };
    }
    if (isSessionLog(parsed)) return { ...empty, format: "session-log" };
    const list = jsonList(parsed);
    if (!list) return { ...empty, format: "json" };
    return collect(list.map(jsonRow), known, "json");
  }
  return collect(textRows(text), known, "text");
}

export async function readImportFileText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let text = new TextDecoder("utf-8").decode(buffer);
  if (text.includes("\uFFFD")) {
    try {
      text = new TextDecoder("gbk").decode(buffer);
    } catch {
      /* keep the UTF-8 result when the runtime lacks the GBK decoder */
    }
  }
  return text;
}

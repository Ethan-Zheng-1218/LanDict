import { createRequire } from "node:module";
import { resolve } from "node:path";

type SqliteStatement = { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] };
type SqliteDatabase = { prepare(sql: string): SqliteStatement };
// 与 server/oxford.ts 和 tools 下的构建脚本保持同一种写法：
// import.meta.url 在 jsdom 测试环境下不是文件 URL，用它拼路径会直接抛错。
const require = createRequire(resolve(process.cwd(), "package.json"));
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string, options: { readOnly: boolean }) => SqliteDatabase;
};

export type EcdictRecord = {
  word: string;
  phonetic: string | null;
  definition: string | null;
  translation: string | null;
  pos: string | null;
  exchange: string | null;
};

export type EcdictLookup = {
  entry: EcdictRecord;
  resolvedWord?: string;
};

/** A word grouped with every inflected form it shares a lemma with. */
export type EcdictWordFamily = {
  lemma: string;
  forms: string[];
};

export const ECDICT_DATABASE_PATH = resolve(process.cwd(), "data/ecdict-sqlite-28/stardict-slim.db");

let database: SqliteDatabase | undefined;
let lookupStatement: SqliteStatement | undefined;
let inflectionLookupStatement: SqliteStatement | undefined;
let reverseLookupStatement: SqliteStatement | undefined;

function getDatabase() {
  database ??= new DatabaseSync(ECDICT_DATABASE_PATH, { readOnly: true });
  return database;
}

function getLookupStatement() {
  lookupStatement ??= getDatabase().prepare(`
    SELECT word, phonetic, definition, translation, pos, exchange
    FROM stardict
    WHERE word = ? COLLATE NOCASE
    LIMIT 1
  `);
  return lookupStatement;
}

function getReverseLookupStatement() {
  reverseLookupStatement ??= getDatabase().prepare(`
    SELECT word, phonetic, definition, translation, pos, exchange
    FROM stardict
    WHERE translation IS NOT NULL AND translation LIKE '%' || ? || '%'
    ORDER BY CASE WHEN translation = ? THEN 0 WHEN translation LIKE '%' || ? || '%' THEN 1 ELSE 2 END,
      CASE WHEN lower(word) = ? THEN 0 ELSE 1 END,
      length(word) ASC
    LIMIT 200
  `);
  return reverseLookupStatement;
}

/**
 * ECDICT packs an entry's word forms into one `exchange` string of `code:form` slots separated by
 * `/`. Slots `0:` and `1:` describe the relation to *another* entry rather than a form of this one:
 * `0:` names the lemma an inflected entry belongs to, and `1:` names the transformation. Every other
 * single-letter code is a real inflected form.
 */
const RELATION_SLOTS = new Set(["0", "1"]);
/** Codes that can only ever sit in front of a real inflected form: plural/past/participle/comparative. */
const INFLECTION_CODE_PATTERN = "[pdi3sfrbtz]";

type ExchangeSlot = { code: string; form: string };

function exchangeSlots(exchange: string | null): ExchangeSlot[] {
  if (!exchange) return [];
  const slots: ExchangeSlot[] = [];
  for (const item of exchange.split("/")) {
    const separator = item.indexOf(":");
    if (separator < 0) continue;
    const code = item.slice(0, separator).trim().toLowerCase();
    const form = item.slice(separator + 1).trim();
    if (code && form) slots.push({ code, form });
  }
  return slots;
}

/** The lemma an inflected entry points back to, read straight out of its `0:` slot. */
export function parseEcdictLemma(exchange: string | null): string | undefined {
  return exchangeSlots(exchange).find((slot) => slot.code === "0")?.form;
}

/** The inflected forms a lemma entry lists, ignoring the `0:`/`1:` relation slots. */
export function parseEcdictForms(exchange: string | null): string[] {
  return [...new Set(
    exchangeSlots(exchange).filter((slot) => !RELATION_SLOTS.has(slot.code)).map((slot) => slot.form),
  )];
}

/**
 * Last resort for a word that has no entry of its own: find the entry that lists it as an inflected
 * form. The pattern only accepts real inflection slots, so a `0:` relation can never answer — that
 * used to make "ran" resolve to the unrelated entry "rans" (whose exchange is `0:ran/1:s`).
 *
 * `queryEcdict` already rejects anything outside `[a-zA-Z'-]`, so the word cannot inject GLOB
 * metacharacters into the pattern.
 */
function getInflectionLookupStatement() {
  inflectionLookupStatement ??= getDatabase().prepare(`
    SELECT word, phonetic, definition, translation, pos, exchange
    FROM stardict
    WHERE exchange IS NOT NULL
      AND lower('/' || exchange || '/') GLOB ?
    ORDER BY length(word) ASC
    LIMIT 1
  `);
  return inflectionLookupStatement;
}

function isWord(value: string) {
  return /^[a-zA-Z]+(?:[-'][a-zA-Z]+)*$/.test(value);
}

export function isChineseWord(value: string) {
  return /^[\p{Script=Han}]{1,2}$/u.test(value.trim());
}

export function queryEcdictReverse(chinese: string): EcdictRecord[] {
  const normalized = chinese.trim();
  if (!isChineseWord(normalized)) return [];
  const records = getReverseLookupStatement().all(normalized, normalized, normalized) as EcdictRecord[];
  const seen = new Set<string>();
  return records.filter((record) => isDirectChineseTranslation(record, normalized)).filter((record) => {
    const key = record.word.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

function isDirectChineseTranslation(record: EcdictRecord, query: string) {
  if (!record.phonetic?.trim() || !record.definition?.trim()) return false;
  if (!record.translation || /(?:\[网络\]|网络)/u.test(record.translation)) return false;
  if (parseEcdictLemma(record.exchange)) return false;
  return record.translation.split(/\r?\n/).some((line) => line.split(/[;,，；]/).some((fragment) => {
    const candidate = fragment.trim()
      .replace(/^[a-z]+\.?\s+/iu, "")
      .replace(/^[\[［【(][^\]］】)]{1,8}[\]］】)]\s*/u, "")
      .trim();
    return candidate === query;
  }));
}

export function queryEcdict(word: string): EcdictRecord | null {
  const normalized = word.trim();
  if (!isWord(normalized)) return null;
  return (getLookupStatement().get(normalized) as EcdictRecord | undefined) ?? null;
}

export function queryEcdictLookup(word: string): EcdictLookup | null {
  const normalized = word.trim();
  if (!isWord(normalized)) return null;

  // An entry for the query itself always wins: searching "children" must keep showing "children".
  const exact = queryEcdict(normalized);
  if (exact) return { entry: withLemmaPhonetic(exact) };

  const inflectedEntry = getInflectionLookupStatement()
    .get(`*/${INFLECTION_CODE_PATTERN}:${normalized.toLowerCase()}/*`) as EcdictRecord | undefined;
  return inflectedEntry ? { entry: inflectedEntry, resolvedWord: inflectedEntry.word } : null;
}

/**
 * Inflected entries such as "flowers" exist in ECDICT without a phonetic of their own, which used
 * to leave the reader showing "英 —". The lemma already carries the pronunciation, so borrow only
 * the phonetic and keep the meanings of the word that was actually looked up.
 */
function withLemmaPhonetic(entry: EcdictRecord): EcdictRecord {
  if (entry.phonetic?.trim()) return entry;
  const lemma = findLemmaEntry(entry.word);
  return lemma?.phonetic?.trim() ? { ...entry, phonetic: lemma.phonetic } : entry;
}

function findLemmaEntry(word: string): EcdictRecord | undefined {
  const declared = getInflectionLookupStatement()
    .get(`*/${INFLECTION_CODE_PATTERN}:${word.toLowerCase()}/*`) as EcdictRecord | undefined;
  if (declared?.phonetic?.trim()) return declared;
  const lower = word.toLowerCase();
  const candidates = [
    lower.replace(/ies$/, "y"),
    lower.replace(/(ches|shes|xes|zes|sses|oes)$/, (match) => match.slice(0, -2)),
    lower.replace(/es$/, ""),
    lower.replace(/s$/, ""),
  ];
  for (const candidate of candidates) {
    if (!candidate || candidate === lower || !isWord(candidate)) continue;
    const entry = queryEcdict(candidate);
    if (entry?.phonetic?.trim()) return entry;
  }
  return undefined;
}

/**
 * Groups a word with every form it inflects through. An inflected entry names its lemma in `0:`, so
 * "ran" and "run" collapse onto the same family. The reading view needs exactly this: a saved word
 * has to light up the article no matter which form the article happens to use.
 */
export function queryWordFamily(word: string): EcdictWordFamily | null {
  const normalized = word.trim();
  if (!isWord(normalized)) return null;

  const entry = queryEcdict(normalized);
  if (!entry) return null;

  const referenced = parseEcdictLemma(entry.exchange);
  const base = referenced && referenced.toLowerCase() !== entry.word.toLowerCase()
    ? queryEcdict(referenced) ?? entry
    : entry;

  return {
    lemma: base.word,
    forms: [...new Set([normalized, base.word, ...parseEcdictForms(base.exchange)])],
  };
}

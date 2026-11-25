/**
 * 词库原子查询层。开发服务器与桌面端 Rust 各有一份实现，两边只做同一件事：
 * 按给定的词返回词库条目。**这一层不做任何优先级判断** ——
 * 谁优先、取几条、怎么排序全部属于前端共享策略层（dictionaryResolver）。
 *
 * 三个来源：牛津主库、CC-CEDICT 反查索引、精简 ECDICT。
 * 任意一份库缺失时把该来源当空结果，不抛异常——开发机在跑完构建脚本之前就是这种状态。
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { ECDICT_DATABASE_PATH, queryEcdict, queryEcdictReverse, type EcdictRecord } from "./ecdict";

const require = createRequire(resolve(process.cwd(), "package.json"));
const { DatabaseSync } = require("node:sqlite");

type Statement = { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] };
type Database = { prepare(sql: string): Statement };

const OXFORD_PATH = resolve(process.cwd(), "data/oxford-sqlite/landict-oxford.db");
const CEDICT_PATH = resolve(process.cwd(), "data/cedict-sqlite/landict-cedict.db");

export type OxfordSense = {
  pos: string;
  definition: string;
  translation: string;
  /** 牛津【IDIOMS】区里的成语，不是这个词本身的义项。 */
  idiom?: boolean;
};

export type OxfordRecord = {
  word: string;
  headword: string;
  pos: string;
  senses: OxfordSense[];
  collocations: string[];
  collocationTranslations: Record<string, string>;
  examples: { pos: string; text: string; translation?: string }[];
};

export type DictionaryHit = {
  oxford?: OxfordRecord;
  ecdict?: EcdictRecord & { bnc?: number | null; frq?: number | null };
};

export type ReverseSource = "cedict" | "oxford" | "ecdict";

export type ReverseHit = {
  word: string;
  source: ReverseSource;
  /** 该中文词在牛津词条里出现的义项序号，越小越接近本义。 */
  senseIndex?: number;
  /** 英文词频（ECDICT 的 bnc 序号），越小越常用；无排名为 undefined。 */
  rank?: number;
};

function open(readPath: string): Database | undefined {
  if (!existsSync(readPath)) return undefined;
  try {
    return new DatabaseSync(readPath, { readOnly: true }) as Database;
  } catch {
    return undefined;
  }
}

let oxford: Database | null | undefined;
let cedict: Database | null | undefined;
let slimEcdict: Database | null | undefined;

const oxfordDb = () => (oxford === undefined ? (oxford = open(OXFORD_PATH) ?? null) : oxford);
const cedictDb = () => (cedict === undefined ? (cedict = open(CEDICT_PATH) ?? null) : cedict);
const slimDb = () => (slimEcdict === undefined ? (slimEcdict = open(ECDICT_DATABASE_PATH) ?? null) : slimEcdict);

/** Only ranked general English words become input/spelling hints, never network guesses. */
export async function suggestDictionaryWords(prefix: string, candidates: string[]): Promise<string[]> {
  const db = slimDb();
  if (!db) return [];
  const rank = "CASE WHEN bnc > 0 THEN bnc WHEN frq > 0 THEN frq ELSE 2147483647 END";
  const common = "(bnc > 0 OR frq > 0) AND word NOT GLOB '*[^a-z]*'";
  const start = prefix.trim().toLowerCase();
  if (start) {
    if (!/^[a-z]{2,32}$/.test(start)) return [];
    const rows = db.prepare(`SELECT word FROM stardict WHERE word >= ? AND word < ? AND length(word) > ? AND ${common} ORDER BY ${rank}, length(word), word LIMIT 5`)
      .all(start, start + "{", start.length) as { word: string }[];
    return rows.map(row => row.word);
  }
  const words = [...new Set(candidates.filter(word => /^[a-z]{2,33}$/.test(word)))].slice(0, 2000);
  const hits: { word: string; rank: number }[] = [];
  for (let offset = 0; offset < words.length; offset += 300) {
    const batch = words.slice(offset, offset + 300);
    hits.push(...db.prepare(`SELECT word, ${rank} AS rank FROM stardict WHERE word IN (${batch.map(() => "?").join(",")}) AND ${common}`).all(...batch) as typeof hits);
  }
  return hits.sort((a, b) => a.rank - b.rank || a.word.localeCompare(b.word)).slice(0, 5).map(hit => hit.word);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function readOxford(word: string): OxfordRecord | undefined {
  const db = oxfordDb();
  if (!db) return undefined;
  const row = db
    .prepare("SELECT headword, pos, senses, collocations, collocation_translations, examples FROM entry WHERE word = ? COLLATE NOCASE LIMIT 1")
    .get(word) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return {
    word,
    headword: String(row.headword ?? word),
    pos: String(row.pos ?? ""),
    senses: parseJson<OxfordSense[]>(row.senses, []),
    collocations: parseJson<string[]>(row.collocations, []),
    collocationTranslations: parseJson<Record<string, string>>(row.collocation_translations, {}),
    examples: parseJson<OxfordRecord["examples"]>(row.examples, []),
  };
}

function readRank(word: string): number | undefined {
  const db = slimDb();
  if (!db) return undefined;
  const row = db
    .prepare("SELECT bnc, frq FROM stardict WHERE word = ? COLLATE NOCASE LIMIT 1")
    .get(word) as { bnc?: number | null; frq?: number | null } | undefined;
  const rank = row?.bnc ?? row?.frq ?? undefined;
  return typeof rank === "number" && rank > 0 ? rank : undefined;
}

function cedictGlosses(term: string): string[] {
  const db = cedictDb();
  if (!db) return [];
  return (db.prepare("SELECT gloss FROM cedict WHERE term = ?").all(term) as { gloss: string }[]).map(
    (row) => row.gloss,
  );
}

function oxfordHanzi(term: string): { word: string; sense_index: number }[] {
  const db = oxfordDb();
  if (!db) return [];
  return db
    .prepare("SELECT word, sense_index FROM hanzi WHERE term = ? ORDER BY sense_index, word")
    .all(term) as { word: string; sense_index: number }[];
}

/**
 * 一次拿回一个词表在牛津与精简 ECDICT 里的命中。
 * 策略层把「原词加全部候选原形」一次性发过来，所以悬浮查词仍然只有一次往返。
 */
export async function lookupWords(words: string[]): Promise<Record<string, DictionaryHit>> {
  const result: Record<string, DictionaryHit> = {};
  for (const raw of words) {
    const word = raw.trim();
    if (!word) continue;
    const key = word.toLowerCase();
    if (key in result) continue;
    const hit: DictionaryHit = {};
    const oxfordRecord = readOxford(word);
    if (oxfordRecord) hit.oxford = oxfordRecord;
    const ecdictRecord = queryEcdict(word);
    if (ecdictRecord) hit.ecdict = ecdictRecord;
    result[key] = hit;
  }
  return result;
}

/** 中文反查：CC-CEDICT 为主，牛津中文索引补充，精简 ECDICT 兜底。排序由策略层负责。 */
export async function reverseLookup(term: string): Promise<ReverseHit[]> {
  const normalized = term.trim();
  if (!normalized) return [];

  const hits: ReverseHit[] = [];
  for (const gloss of cedictGlosses(normalized)) hits.push({ word: gloss, source: "cedict" });
  for (const row of oxfordHanzi(normalized)) {
    hits.push({ word: row.word, source: "oxford", senseIndex: row.sense_index });
  }
  for (const entry of queryEcdictReverse(normalized)) hits.push({ word: entry.word, source: "ecdict" });

  return hits.map((hit) => {
    const rank = readRank(hit.word);
    return rank === undefined ? hit : { ...hit, rank };
  });
}

/** 牛津自带的变形指向（pt of / pl. of），用于阅读页词族。 */
export async function lookupLemmas(words: string[]): Promise<Record<string, string>> {
  const db = oxfordDb();
  if (!db) return {};
  const result: Record<string, string> = {};
  for (const raw of words) {
    const word = raw.trim().toLowerCase();
    if (!word || word in result) continue;
    const row = db.prepare("SELECT base FROM lemma WHERE form = ? COLLATE NOCASE LIMIT 1").get(word) as
      | { base: string }
      | undefined;
    if (row?.base) result[word] = row.base;
  }
  return result;
}

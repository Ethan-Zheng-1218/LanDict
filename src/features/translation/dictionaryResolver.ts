/**
 * 查词策略层。开发版与桌面版共用这一份，原子查询层只负责取数据。
 *
 * 优先级（设计文档 7.1）：牛津精确 -> 牛津经词形还原 -> 精简 ECDICT 精确
 * -> 精简 ECDICT 经词形还原 -> 未收录。
 *
 * **音标与音频不在这里产生。** `lookupPronunciation` 是可选的，由调用方按平台注入：
 * 开发版走已有的 /api/local-dictionary（牛津 IPA 优先），桌面版走已有的
 * desktop_dictionary（ECDICT 音标）。这样迁到新链路后两端的音标来源与今天完全一致，
 * 设计文档第八节的硬边界得以保持。
 */

import { lemmaCandidates } from "../../lib/lemmatizer";
import type { DictionaryHit, ReverseHit, ReverseSource } from "../../../server/dictionaryLookup";
import { adaptEcdictRecord } from "./ecdictAdapter";
import type { DictionaryEntry, DictionaryMeaning, QueryPanel, WordQueryResult } from "./translationService";

export const OXFORD_SOURCE_LABEL = "牛津高阶";
export const LOCAL_SOURCE_LABEL = "本地词库";
export const EMPTY_MEANING = "暂未收录释义";
export const NOT_FOUND_BODY = "词库暂未收录这个单词。";

export type PronunciationHint = {
  britishIpa?: string;
  americanIpa?: string;
  americanAudioUrl?: string;
  ecdictPhonetic?: string;
};

export type DictionaryAtomicApi = {
  lookupSuggestions?(prefix: string, words: string[], signal?: AbortSignal): Promise<string[]>;
  lookupWords(words: string[], signal?: AbortSignal): Promise<Record<string, DictionaryHit>>;
  reverseLookup(term: string, signal?: AbortSignal): Promise<ReverseHit[]>;
  lookupLemmas(words: string[], signal?: AbortSignal): Promise<Record<string, string>>;
  /** 可选。缺失时只影响音标展示字段，释义、例句、搭配照常。 */
  lookupPronunciation?(word: string, signal?: AbortSignal): Promise<PronunciationHint>;
};

/**
 * 牛津义项按词性归组成中文释义。
 * 成语（idiom）不计入：`be the cat's whiskers` 是成语，不是 cat 这个词的义项，
 * 混进来会让查 cat 的第一条释义变成「最棒的东西」。
 */
function meaningsFromOxford(senses: NonNullable<DictionaryHit["oxford"]>["senses"]): DictionaryMeaning[] {
  const groups = new Map<string, string[]>();
  for (const sense of senses) {
    if (sense.idiom || !sense.translation) continue;
    const partOfSpeech = sense.pos || "";
    const translations = groups.get(partOfSpeech) ?? [];
    if (!translations.includes(sense.translation)) translations.push(sense.translation);
    groups.set(partOfSpeech, translations);
  }
  return [...groups].map(([partOfSpeech, translations]) => ({ partOfSpeech, translations }));
}

function emptyPanels(query: string): QueryPanel[] {
  return [{ id: "ecdict", label: "词库解释", badge: "", title: query, body: NOT_FOUND_BODY }];
}

function emptyResult(query: string): WordQueryResult {
  return {
    kind: "word",
    query,
    status: "empty",
    entries: [],
    britishPhonetic: "—",
    americanPhonetic: "—",
    meaning: EMPTY_MEANING,
    example: "",
    source: LOCAL_SOURCE_LABEL,
    panels: emptyPanels(query),
  };
}

function buildOxfordEntry(
  hit: NonNullable<DictionaryHit["oxford"]>,
  pronunciation: PronunciationHint,
): DictionaryEntry {
  const meanings = meaningsFromOxford(hit.senses);
  const definitions = hit.senses
    .filter((sense) => !sense.idiom && sense.definition)
    .map((sense) => sense.definition);
  const translations = meanings.flatMap((meaning) => meaning.translations);
  const fallbackPhonetic = pronunciation.ecdictPhonetic ?? "";

  return {
    word: hit.headword || hit.word,
    phonetic: pronunciation.britishIpa || fallbackPhonetic,
    britishPhonetic: pronunciation.britishIpa || fallbackPhonetic,
    americanPhonetic: pronunciation.americanIpa || fallbackPhonetic,
    partOfSpeech: hit.pos,
    meanings,
    definitions,
    example: hit.examples[0]?.text ?? "",
    collocations: hit.collocations,
    collocationTranslations: hit.collocationTranslations,
    wordForms: [],
    meaning: translations.join("\n"),
    definition: definitions.join("\n"),
    exchange: [],
    // 词库里的例句用 pos，界面类型用 partOfSpeech，在这里转换一次。
    examples: hit.examples.map((example) => ({
      partOfSpeech: example.pos,
      text: example.text,
      ...(example.translation ? { translation: example.translation } : {}),
    })),
    // 这个字段是历史遗留的联合类型，与展示无关；本次不改类型以免牵动生词本存储。
    source: "ECDICT",
  };
}

export type ResolvedWord = {
  key: string;
  fromOxford: boolean;
  hit: DictionaryHit;
};

/** 精确命中优先于词形还原；牛津优先于 ECDICT。 */
export function pickHit(
  query: string,
  hits: Record<string, DictionaryHit>,
): ResolvedWord | undefined {
  const exactKey = query.toLowerCase();
  const candidates = lemmaCandidates(query).map((candidate) => candidate.toLowerCase());

  const oxfordKey = [exactKey, ...candidates].find((key) => hits[key]?.oxford);
  if (oxfordKey) return { key: oxfordKey, fromOxford: true, hit: hits[oxfordKey] };

  const ecdictKey = [exactKey, ...candidates].find((key) => hits[key]?.ecdict);
  if (ecdictKey) return { key: ecdictKey, fromOxford: false, hit: hits[ecdictKey] };

  return undefined;
}

/**
 * 查一个英文词。一次往返：把「原词加全部候选原形」一次性发出去。
 * 中文输入不归这一层管，交由 resolveChineseQuery。
 */
export async function resolveWordQuery(
  query: string,
  api: DictionaryAtomicApi,
  signal?: AbortSignal,
): Promise<WordQueryResult> {
  const normalized = query.trim();
  if (!normalized) return emptyResult(normalized);

  const words = [normalized, ...lemmaCandidates(normalized)];
  const hits = await api.lookupWords(words, signal);
  const resolved = pickHit(normalized, hits);
  if (!resolved) return emptyResult(normalized);

  const { hit, key, fromOxford } = resolved;
  const pronunciation = api.lookupPronunciation
    ? await api.lookupPronunciation(hit.ecdict?.word ?? hit.oxford?.headword ?? normalized, signal)
    : {};

  const entry = fromOxford && hit.oxford
    ? buildOxfordEntry(hit.oxford, pronunciation)
    : hit.ecdict
      ? adaptEcdictRecord(hit.ecdict)
      : undefined;
  if (!entry) return emptyResult(normalized);

  if (!fromOxford && !pronunciation.britishIpa && hit.ecdict?.phonetic) {
    entry.phonetic = entry.phonetic || hit.ecdict.phonetic;
  }

  const resolvedWord = key !== normalized.toLowerCase() ? key : undefined;
  const source = fromOxford ? OXFORD_SOURCE_LABEL : LOCAL_SOURCE_LABEL;
  const panel: QueryPanel = {
    id: "ecdict",
    label: "词库解释",
    badge: "",
    title: resolvedWord ? `${entry.word}（${normalized}）` : "",
    body: entry.definitions.join("\n"),
  };

  return {
    kind: "word",
    query: normalized,
    status: "success",
    ...(resolvedWord ? { resolvedWord: entry.word } : {}),
    entries: [entry],
    britishPhonetic: entry.britishPhonetic || "—",
    americanPhonetic: entry.americanPhonetic || "—",
    ...(pronunciation.americanAudioUrl ? { americanAudioUrl: pronunciation.americanAudioUrl } : {}),
    meaning: entry.meanings.flatMap((meaning) => meaning.translations).join("\n") || EMPTY_MEANING,
    example: entry.example,
    source,
    panels: [panel],
  };
}

// ---------------------------------------------------------------------------
// 中文反查排序
// ---------------------------------------------------------------------------

/** 反查一次给几条。排序存在已知短板，6 条比 4 条多留两点容错。 */
export const REVERSE_LOOKUP_LIMIT = 6;

/**
 * 多词短语在 ECDICT 里没有词频。给它们一个中位值，而不是垫底：
 * `睡觉` 的正确答案是 go to bed，`生气` 是 get angry / be furious——如果短语一律垫底，
 * 这些词就会被 vitality 之类的冷门单词挤掉。中位值让常用短语压过冷门单词，
 * 又不会盖过 abandon 这种真正高频的词。
 */
const PHRASE_RANK = 5000;

/** CC-CEDICT 是真正的汉英词典，优先于把英汉数据倒着用的牛津索引；精简 ECDICT 最后兜底。 */
const SOURCE_ORDER: Record<ReverseSource, number> = { cedict: 0, oxford: 1, ecdict: 2 };

function rankValue(hit: ReverseHit): number {
  if (typeof hit.rank === "number" && hit.rank > 0) return hit.rank;
  return hit.word.includes(" ") ? PHRASE_RANK : Number.MAX_SAFE_INTEGER;
}

/**
 * 排序规则（实测选定，见设计文档 7.2）：
 * 来源顺序 -> 英文词频（短语取中位值）-> 牛津义项位置 -> 字母序。
 *
 * 词频不能放在第一优先级：牛津的 get / give / back 有上百个义项，某个次要义项里
 * 带过「放弃」，它们的高词频会让首条变成 get。来源优先把这类噪音压到 CC-CEDICT 之后。
 */
export function compareReverseHits(a: ReverseHit, b: ReverseHit): number {
  const source = SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source];
  if (source) return source;
  const rank = rankValue(a) - rankValue(b);
  if (rank) return rank;
  const sense = (a.senseIndex ?? 0) - (b.senseIndex ?? 0);
  if (sense) return sense;
  return a.word.localeCompare(b.word);
}

/** 同一个词可能同时来自多个来源，保留排序最好的那一条。 */
export function rankReverseHits(hits: ReverseHit[]): ReverseHit[] {
  const best = new Map<string, ReverseHit>();
  for (const hit of hits) {
    const key = hit.word.toLowerCase();
    const current = best.get(key);
    if (!current || compareReverseHits(hit, current) < 0) best.set(key, hit);
  }
  return [...best.values()].sort(compareReverseHits);
}

/**
 * 候选词自己的中文释义。CC-CEDICT 只给英文注释，中文要拿这个英文词回词库查一次。
 * 优先用牛津的义项翻译（它是学习者向的），退而用 ECDICT，并剥掉词性前缀只留第一段。
 */
function chineseMeaningOf(hit: DictionaryHit | undefined): string {
  const oxford = hit?.oxford?.senses.find((sense) => !sense.idiom && sense.translation);
  if (oxford?.translation) return oxford.translation;
  const firstLine = (hit?.ecdict?.translation ?? "").split("\n")[0] ?? "";
  return (firstLine.split(/[，,；;]/)[0] ?? "").replace(/^[a-z]+\.\s*/i, "").trim();
}

/** 每条候选独占一行的分隔符：界面样式已经设了 pre-line，换行会原样显示。 */
const CANDIDATE_LINE_SEPARATOR = "\n";
/** 单词与它自己释义之间的间隔，用全角空格而不是标点。 */
const MEANING_GAP = "\u3000";

/** 中文查英文。每个候选词独占一行，后面跟上它自己的中文释义。 */
export async function resolveChineseQuery(
  query: string,
  api: DictionaryAtomicApi,
  signal?: AbortSignal,
): Promise<WordQueryResult> {
  const normalized = query.trim();
  const ranked = rankReverseHits(await api.reverseLookup(normalized, signal)).slice(0, REVERSE_LOOKUP_LIMIT);
  if (!ranked.length) return emptyResult(normalized);

  // 光给英文词读者分不清这些近义词，所以回查一次它们各自的中文释义。
  const hits = await api.lookupWords(ranked.map((hit) => hit.word), signal);
  const body = ranked
    .map((hit) => {
      const meaning = chineseMeaningOf(hits[hit.word.toLowerCase()]);
      return meaning ? `${hit.word}${MEANING_GAP}${meaning}` : hit.word;
    })
    .join(CANDIDATE_LINE_SEPARATOR);
  const panel: QueryPanel = {
    id: "ecdict",
    label: "词库解释",
    badge: "",
    title: normalized,
    body,
  };
  return {
    kind: "word",
    query: normalized,
    status: "success",
    entries: [],
    britishPhonetic: "—",
    americanPhonetic: "—",
    meaning: body,
    example: "",
    source: LOCAL_SOURCE_LABEL,
    panels: [panel],
  };
}

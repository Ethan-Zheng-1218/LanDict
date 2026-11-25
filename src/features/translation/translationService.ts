import { describeAiError, isAiConfigured, requestAiPanels, type AiPanel } from "./aiTranslationProvider";
import type { AiLearningCategory } from "./aiLearning";
import { createDictionaryApi } from "./dictionaryProvider";
import { resolveChineseQuery, resolveWordQuery } from "./dictionaryResolver";
import { translateLocally } from "./localTranslationProvider";
import { isSupportedYoudaoQuery, lookupYoudaoDictionary } from "./youdaoDictionary";
import { correctSpelling } from "./spellingResolver";

export type QueryKind = "word" | "phrase" | "text";
export type QueryStatus = "success" | "loading" | "empty" | "unconfigured" | "error";
export type QueryPanel = { id: string; label: string; badge: string; title: string; body: string };
export type DictionaryMeaning = { partOfSpeech: string; translations: string[] };
export type DictionaryDefinition = string;
export type DictionaryExample = { partOfSpeech: string; text: string; translation?: string };
export type DictionaryWordForm = { label: string; value: string; relatedWord?: string };
export type DictionaryEntry = {
  word: string;
  phonetic: string;
  britishPhonetic: string;
  americanPhonetic: string;
  partOfSpeech: string;
  meanings: DictionaryMeaning[];
  definitions: DictionaryDefinition[];
  example: string;
  collocations: string[];
  collocationTranslations?: Record<string, string>;
  examples: DictionaryExample[];
  wordForms: DictionaryWordForm[];
  /** Legacy flattened fields kept for vocabulary persistence compatibility. */
  meaning: string;
  definition: string;
  exchange: string[];
  source: "ECDICT" | "Youdao";
};
export type WordQueryResult = {
  kind: "word"; query: string; status: QueryStatus; entries: DictionaryEntry[]; britishPhonetic: string; americanPhonetic: string;
  meaning: string; example: string; source: string; panels: QueryPanel[]; resolvedWord?: string; americanAudioUrl?: string;
  correctedWord?: string; spellingSuggestions?: string[];
};
export type AiQueryResult = { kind: "phrase" | "text"; query: string; status: QueryStatus; panels: QueryPanel[] };
export type QueryResult = WordQueryResult | AiQueryResult;
export type TranslationResult =
  | { kind: "word"; title: string; phonetic: string; meaning: string; example: string; source: string }
  | { kind: "text"; title: string; translation: string; explanation: string; provider: string };

export function isChineseWord(value: string) {
  return /^[\p{Script=Han}]{1,2}$/u.test(value.trim());
}

export function classifyQuery(query: string): QueryKind {
  const normalized = query.trim();
  if (isChineseWord(normalized)) return "word";
  if (/^[a-zA-Z]+(?:[-'][a-zA-Z]+)*$/.test(normalized)) return "word";
  if (/[\p{Script=Han}]/u.test(normalized)) return "text";
  if (!/[.!?。！？\n]/.test(normalized) && normalized.split(/\s+/).length <= 6) return "phrase";
  return "text";
}

export function getQueryResult(query: string, options: { ai?: boolean } = {}): QueryResult {
  const normalized = query.trim();
  const kind = classifyQuery(normalized);
  const withAi = options.ai ?? true;
  if (kind !== "word") {
    const title = "";
    // The card stays collapsed; expanding it is what starts the AI call.
    const panels: QueryPanel[] = [{
      id: "local", label: "本地翻译", badge: "免费 · 离线", title,
      body: "正在使用内置模型翻译…",
    }, {
      id: "ai",
      label: "AI 翻译",
      badge: "点击展开",
      title,
      body: "展开后调用 AI，返回日常表达与学术书面两个版本。",
    }];
    return {
      kind, query: normalized,
      status: "loading",
      panels,
    };
  }

  const panels: QueryPanel[] = [
    { id: "ecdict", label: "词库解释", badge: "", title: normalized, body: "正在查询词库…" },
  ];
  if (withAi) panels.push({ id: "ai", label: "AI 翻译", badge: "点击展开", title: "", body: "展开后调用 AI，补充用法、常见搭配与例句。" });
  return {
    kind: "word", query: normalized, status: "loading", entries: [], britishPhonetic: "—", americanPhonetic: "—",
    meaning: "正在查询词库", example: "", source: "词库解释", panels,
  };
}

/** Shown inside an AI card while the request is running. */
export const AI_LOADING_PANEL: QueryPanel = {
  id: "ai",
  label: "AI 翻译",
  badge: "调用中",
  title: "正在调用 AI…",
  body: "正在请求翻译接口，请稍候。",
};

/** Replaces the placeholder card with the real AI panels (or the failure reason). */
export async function loadAiPanels(
  query: string,
  options: {
    mode?: "word" | "phrase" | "text";
    learning?: AiLearningCategory;
    context?: string;
    register?: "neutral" | "news";
    label?: string;
    badge?: string;
    title?: string;
  } = {},
  signal?: AbortSignal,
): Promise<QueryPanel[]> {
  const kind = classifyQuery(query);
  try {
    const panels = await requestAiPanels({
      text: query,
      mode: options.mode ?? (kind === "word" ? "word" : "text"),
      ...(options.learning ? { learning: options.learning } : {}),
      ...(options.context ? { context: options.context } : {}),
      ...(options.register ? { register: options.register } : {}),
    }, signal);
    return panels as AiPanel[];
  } catch (error) {
    return [{
      id: "ai-error",
      label: options.label ?? "AI 翻译",
      badge: options.badge ?? (isAiConfigured() ? "调用失败" : "未配置"),
      title: options.title ?? "AI 调用未完成",
      body: describeAiError(error),
    }];
  }
}

/** Explicit text translation stays local. Dictionary matching belongs to resolveQuery. */
export async function resolveTextQuery(
  query: string,
  _options: { register?: "neutral" | "news" } = {},
  signal?: AbortSignal,
): Promise<AiQueryResult> {
  const base = getQueryResult(query) as AiQueryResult;
  try {
    const translated = await translateLocally(query, signal);
    return { ...base, status: "success", panels: base.panels.map(panel => panel.id === "local" ? {
      ...panel, title: translated.target === "zh" ? "中文翻译" : "英文翻译", body: translated.translation,
    } : panel) };
  } catch (error) {
    if (signal?.aborted) throw error;
    const detail = error instanceof Error ? error.message : "本地翻译暂时不可用，请重试。";
    return { ...base, status: "error", panels: base.panels.map(panel => panel.id === "local" ? {
      ...panel, badge: "翻译失败", body: detail,
    } : panel) };
  }
}

/** Replaces every AI card of a result while its request is running. */
export function withAiLoadingPanels(result: QueryResult): QueryResult {
  return { ...result, panels: [...result.panels.filter((panel) => !isAiPanelId(panel.id)), AI_LOADING_PANEL] };
}

export function isAiPanelId(id: string) {
  return id === "ai" || id.startsWith("ai-");
}

/** Swaps the placeholder card(s) for the panels the provider returned. */
export function mergeAiPanels(result: QueryResult, panels: QueryPanel[]): QueryResult {
  return {
    ...result,
    status: result.status,
    panels: [...result.panels.filter((panel) => !isAiPanelId(panel.id)), ...panels],
  };
}

export async function resolveQuery(query: string, signal?: AbortSignal, options: { ai?: boolean; spelling?: boolean } = {}): Promise<QueryResult> {
  signal?.throwIfAborted();
  const base = getQueryResult(query, options);
  if (base.kind !== "word") {
    // A dictionary hit does not turn a phrase/Chinese text into a saved English word.
    // Exact headword matching rejects suggestions and sentence/web translations.
    const dictionary = isSupportedYoudaoQuery(base.query) ? await lookupYoudaoDictionary(base.query, signal) : undefined;
    if (dictionary) return { ...base, status: "success", panels: base.panels.map(panel => panel.id === "local" ? {
      ...panel, label: "词库解释", badge: "", title: dictionary.source, body: dictionary.meaning,
    } : panel) };
    return resolveTextQuery(base.query, {}, signal);
  }
  try {
    const api = createDictionaryApi();
    let resolved = await lookupYoudaoDictionary(base.query, signal)
      ?? await (isChineseWord(base.query) ? resolveChineseQuery(base.query, api, signal) : resolveWordQuery(base.query, api, signal));
    // Spelling assistance is opt-in for submitted searches, not background/reading lookups.
    if (options.spelling && !isChineseWord(base.query)) resolved = await correctSpelling(resolved, api, signal);
    // 保留「AI 翻译」的占位卡片，展开逻辑不变。
    return { ...resolved, panels: [...resolved.panels, ...base.panels.filter((panel) => isAiPanelId(panel.id))] };
  } catch {
    signal?.throwIfAborted();
    return { ...base, status: "error", meaning: "词库暂时不可用", panels: base.panels.map(panel => panel.id === "ecdict" ? { ...panel, body: "词库暂时不可用，请稍后重试。" } : panel) };
  }
}

export function translateDemo(query: string): TranslationResult {
  const result = getQueryResult(query);
  if (result.kind === "word") return { kind: "word", title: result.query, phonetic: result.britishPhonetic, meaning: result.meaning, example: result.example, source: result.source };
  return { kind: "text", title: result.query, translation: "正在使用内置模型翻译…", explanation: "免费本地翻译；可在设置中开启 AI 自动翻译。", provider: "本地翻译" };
}

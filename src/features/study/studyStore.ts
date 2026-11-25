/**
 * 背单词的数据层：词库清单 + 学习进度。
 *
 * 词库来自 `public/wordbooks/<id>.json`，由 `tools/build-wordbooks.mjs` 生成并提交进仓库，
 * 前端直接 fetch（开发版和打包后的桌面端都走同一份，见 tauri.conf.json 的 frontendDist）。
 *
 * 进度按**原形**存：`studies` 和 `study` 是同一份记忆，这正是"跨来源共用"的实现方式。
 * 目前复用应用已有的 browserStorage；换成独立 SQLite 是下一步（要动 Rust 侧），
 * 届时只需要替换本文件底部的 readProgress/writeProgress 两个函数。
 */

import { useCallback, useEffect, useState } from "react";

import { dispatchStorageEvent, readStored, writeStored } from "../../lib/browserStorage";
import { dueFrom, intervalDays, isDue, nextLevel, type GradeAction } from "./studyRules";
import type { StudyStep } from "./studyRules";

export const STUDY_STORAGE_KEY = "landict.study.v1";
export const STUDY_CHANGED_EVENT = "landict:study-changed";

/** 一次判定之后落盘的记忆状态。removed 表示"不再出现"。 */
export type WordMemory = {
  level: number;
  /** 下次到期时间（ISO）。 */
  dueAt: string;
  removed?: boolean;
  updatedAt: string;
};

export type StudyProgress = Record<string, WordMemory>;

/** 一个词库的来源。词库和生词本共用同一个结构，判定规则完全一致。 */
export type StudySource = {
  id: string;
  name: string;
  /** 分组：考试词库 / 词组库 / 生词本。三者共用队列和判定规则。 */
  group: "book" | "phrase" | "vocab";
  unit: string;
};

const isWordMemory = (value: unknown): value is WordMemory => {
  if (!value || typeof value !== "object") return false;
  const memory = value as Partial<WordMemory>;
  return typeof memory.level === "number" && typeof memory.dueAt === "string";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeProgress(value: unknown): StudyProgress {
  if (!value || typeof value !== "object") return {};
  const result: StudyProgress = {};
  for (const [word, memory] of Object.entries(value as Record<string, unknown>)) {
    if (isWordMemory(memory)) {
      result[word.toLowerCase()] = {
        level: Math.max(0, Math.min(7, Math.round(memory.level))),
        dueAt: memory.dueAt,
        ...(memory.removed ? { removed: true } : {}),
        updatedAt: typeof memory.updatedAt === "string" ? memory.updatedAt : memory.dueAt,
      };
    }
  }
  return result;
}

export function readProgress(): StudyProgress {
  return normalizeProgress(readStored<Record<string, unknown>>(STUDY_STORAGE_KEY, {}, isRecord));
}

function persist(progress: StudyProgress): void {
  writeStored(STUDY_STORAGE_KEY, progress);
  dispatchStorageEvent(STUDY_CHANGED_EVENT);
}

/** 整体覆盖写。会话按自己的记录重算进度时用，避免逐条打补丁打错。 */
export function writeProgress(progress: StudyProgress): void {
  persist(progress);
}

export function useProgress(): StudyProgress {
  const [progress, setProgress] = useState<StudyProgress>(() => readProgress());
  const refresh = useCallback(() => setProgress(readProgress()), []);
  useEffect(() => {
    window.addEventListener(STUDY_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(STUDY_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);
  return progress;
}

/**
 * 记一次判定。`action` 是三个评级动作之一（加入生词本和不再出现由调用方另行处理）。
 * 返回这个词的新记忆状态。
 */
export function recordGrade(word: string, action: GradeAction, now = new Date()): WordMemory {
  const progress = readProgress();
  const key = word.toLowerCase();
  const level = nextLevel(progress[key]?.level ?? 0, action);
  const memory: WordMemory = {
    level,
    dueAt: dueFrom(now, intervalDays(level, action)),
    updatedAt: now.toISOString(),
  };
  progress[key] = memory;
  persist(progress);
  return memory;
}

/** 「不再出现」：记下来，之后不再进任何队列。不影响记忆档位。 */
export function markRemoved(word: string, now = new Date()): void {
  const progress = readProgress();
  const key = word.toLowerCase();
  progress[key] = {
    level: progress[key]?.level ?? 0,
    dueAt: progress[key]?.dueAt ?? now.toISOString(),
    removed: true,
    updatedAt: now.toISOString(),
  };
  persist(progress);
}

/** 撤销时用：把某个词恢复成给定状态；传 undefined 就删掉这条记录。 */
export function restoreMemory(word: string, memory: WordMemory | undefined): void {
  const progress = readProgress();
  const key = word.toLowerCase();
  if (memory) progress[key] = memory;
  else delete progress[key];
  persist(progress);
}

/**
 * 按本轮记录重算进度。
 *
 * 会话里的记录是权威的（撤销会把记录弹掉），所以每次动作后都拿「进会话前的进度」重算一遍，
 * 而不是逐条打补丁 —— 这样天然幂等，也不会因为"先判定又被移出"这类改判算错。
 * 加入生词本和不认识一样回炉、降低档位，同时由页面另行写入生词本。
 */
export function applySessionProgress(
  base: StudyProgress,
  steps: readonly StudyStep[],
  now = new Date(),
): StudyProgress {
  const next: StudyProgress = { ...base };
  for (const step of steps) {
    const key = step.word.toLowerCase();
    if (!key) continue;
    const previous = next[key];
    if (step.action === "removed") {
      next[key] = {
        level: previous?.level ?? 0,
        dueAt: previous?.dueAt ?? now.toISOString(),
        removed: true,
        updatedAt: now.toISOString(),
      };
      continue;
    }
    const action = step.action === "saved" ? "unknown" : step.action;
    const level = nextLevel(previous?.level ?? 0, action);
    next[key] = { level, dueAt: dueFrom(now, intervalDays(level, action)), updatedAt: now.toISOString() };
  }
  return next;
}

/** 进度条口径：背过的词数 / 总数。不再出现的词也算背过。 */
export function learnedRatio(words: readonly string[], progress: StudyProgress): number {
  if (!words.length) return 0;
  const learned = learnedCount(words, progress);
  return Math.round((learned / words.length) * 1000) / 10;
}

/** 背过的词数（进度里有记录的都算，含已标为不再出现的）。 */
export function learnedCount(words: readonly string[], progress: StudyProgress): number {
  return words.filter((word) => progress[word.toLowerCase()]).length;
}

/** 还没背过的词数：新学队列就是从这些词里取的。 */
export function pendingCount(words: readonly string[], progress: StudyProgress): number {
  return Math.max(0, words.length - learnedCount(words, progress));
}

/* ── 词库清单 ───────────────────────────────────────────── */

export const WORD_BOOKS: StudySource[] = [
  { id: "cet4", name: "四级", group: "book", unit: "词" },
  { id: "cet6", name: "六级", group: "book", unit: "词" },
  { id: "ky", name: "考研", group: "book", unit: "词" },
  { id: "gk", name: "高考", group: "book", unit: "词" },
  { id: "ielts", name: "雅思", group: "book", unit: "词" },
  { id: "toefl", name: "托福", group: "book", unit: "词" },
  { id: "gre", name: "GRE", group: "book", unit: "词" },
  { id: "core", name: "生活高频", group: "book", unit: "词" },
];

export const VOCAB_SOURCE: StudySource = { id: "mine", name: "我的生词本", group: "vocab", unit: "词" };

/** 词组库。词条由 `tools/build-phrasebooks.mjs` 从牛津库生成，和考试词库同一套格式。 */
export const PHRASE_BOOKS: StudySource[] = [
  { id: "idiom", name: "固定习语", group: "phrase", unit: "条" },
  { id: "colloc", name: "常见搭配", group: "phrase", unit: "条" },
  { id: "multiword", name: "多词词条", group: "phrase", unit: "条" },
];

/** 首页要展示的全部词库来源（不含生词本，生词本来自本地收藏）。 */
export const ALL_BOOKS: StudySource[] = [...WORD_BOOKS, ...PHRASE_BOOKS];

type WordbookPayload = { id: string; name: string; count: number; words: string[] };

/** 词组库里每条自带的资料：中文释义、习语的英文解释、例句。 */
export type WordbookMeaning = { cn?: string; en?: string };
export type WordbookExample = { en: string; cn?: string; source?: string };
export type WordbookDetail = {
  words: string[];
  meanings: Record<string, WordbookMeaning>;
  examples: Record<string, WordbookExample>;
};

type StoredWordbook = WordbookPayload & Partial<Pick<WordbookDetail, "meanings" | "examples">>;

const EMPTY_DETAIL: WordbookDetail = { words: [], meanings: {}, examples: {} };
const bookCache = new Map<string, WordbookDetail>();

function toDetail(payload: StoredWordbook): WordbookDetail {
  return {
    words: Array.isArray(payload.words) ? payload.words.filter((word) => typeof word === "string") : [],
    meanings: payload.meanings && typeof payload.meanings === "object" ? payload.meanings : {},
    examples: payload.examples && typeof payload.examples === "object" ? payload.examples : {},
  };
}

/** 读一个词库的全部内容（词表 + 释义 + 例句）。失败时给空表，调用方提示即可。 */
export async function loadWordbookDetail(id: string, signal?: AbortSignal): Promise<WordbookDetail> {
  const cached = bookCache.get(id);
  if (cached) return cached;
  try {
    const response = await fetch(`/wordbooks/${id}.json`, signal ? { signal } : undefined);
    if (!response.ok) return EMPTY_DETAIL;
    const detail = toDetail((await response.json()) as StoredWordbook);
    bookCache.set(id, detail);
    return detail;
  } catch {
    return EMPTY_DETAIL;
  }
}

/** 读一个词库的单词表。失败时返回空数组——调用方提示"词库没加载出来"即可。 */
export async function loadWordbook(id: string, signal?: AbortSignal): Promise<string[]> {
  return (await loadWordbookDetail(id, signal)).words;
}

/**
 * 一次读多个词库。首页每个 chip 都要显示词条数和已背比例，所以打开页面时就把
 * 全部词库取回来（十几份 JSON，合计约 1 MB，本地读取）。失败的那份当空表。
 */
export async function loadWordbooks(
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<Record<string, string[]>> {
  const loaded = await Promise.all(ids.map(async (id) => [id, await loadWordbook(id, signal)] as const));
  if (signal?.aborted) return {};
  return Object.fromEntries(loaded);
}

/* ── 组队列 ─────────────────────────────────────────────── */

export type StudyMode = "new" | "review";

/**
 * 挑出本轮要背的词。
 * 新学：还没背过的（进度里没有记录），按词库顺序取前 N 个。
 * 复习：到期时间 ≤ 今天的**全部**条目——昨天、上个月到期的都一起排进来，不会丢。
 */
export function pickSessionWords(
  words: readonly string[],
  progress: StudyProgress,
  mode: StudyMode,
  limit: number,
  now = new Date(),
): string[] {
  if (mode === "new") {
    return words.filter((word) => !progress[word.toLowerCase()]).slice(0, limit);
  }
  return words.filter((word) => {
    const memory = progress[word.toLowerCase()];
    if (!memory || memory.removed) return false;
    return isDue(memory.dueAt, now);
  });
}

export function countDue(words: readonly string[], progress: StudyProgress, now = new Date()): number {
  return pickSessionWords(words, progress, "review", Number.MAX_SAFE_INTEGER, now).length;
}

/**
 * 到期条目按「今天刚到期」和「之前积压的」拆开。
 * 界面要说明待复习为什么有时突然变大，所以两者得分开数（合起来就是 countDue）。
 */
export function dueBreakdown(
  words: readonly string[],
  progress: StudyProgress,
  now = new Date(),
): { today: number; overdue: number } {
  const startOfToday = new Date(now.getTime());
  startOfToday.setHours(0, 0, 0, 0);
  let today = 0;
  let overdue = 0;
  for (const word of words) {
    const memory = progress[word.toLowerCase()];
    if (!memory || memory.removed || !isDue(memory.dueAt, now)) continue;
    const dueAt = new Date(memory.dueAt);
    if (dueAt.getTime() < startOfToday.getTime()) overdue += 1;
    else today += 1;
  }
  return { today, overdue };
}

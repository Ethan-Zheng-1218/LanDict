import { beforeEach, describe, expect, it } from "vitest";

import {
  applySessionProgress,
  countDue,
  learnedRatio,
  markRemoved,
  pickSessionWords,
  readProgress,
  recordGrade,
  restoreMemory,
  STUDY_STORAGE_KEY,
  type StudyProgress,
} from "./studyStore";

const NOW = new Date("2026-10-14T09:00:00+08:00");
const WORDS = ["abandon", "subtle", "genuine", "thrive"];

const daysAgo = (days: number) => {
  const date = new Date(NOW.getTime());
  date.setDate(date.getDate() - days);
  return date.toISOString();
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("学习进度落盘", () => {
  it("加入生词本按不认识规则降低档位并在当天回炉", () => {
    const progress = applySessionProgress(
      { abandon: { level: 3, dueAt: "2026-10-20T00:00:00.000Z", updatedAt: NOW.toISOString() } },
      [{ index: 0, word: "abandon", action: "saved", insertedAt: 5, savedWord: "abandon" }],
      NOW,
    );
    expect(progress.abandon).toMatchObject({ level: 1, dueAt: NOW.toISOString() });
  });

  it("答对一次升到 L1，一天后到期", () => {
    const memory = recordGrade("abandon", "known", NOW);
    expect(memory.level).toBe(1);
    expect(new Date(memory.dueAt).getTime()).toBeGreaterThan(NOW.getTime());
    expect(readProgress().abandon).toEqual(memory);
  });

  it("单词按小写归一，Abandon 和 abandon 是同一份记忆", () => {
    recordGrade("Abandon", "known", NOW);
    expect(readProgress().abandon?.level).toBe(1);
  });

  it("答错退两级，最低停在 0", () => {
    recordGrade("subtle", "known", NOW);
    recordGrade("subtle", "known", NOW);
    expect(recordGrade("subtle", "unknown", NOW).level).toBe(0);
    expect(recordGrade("subtle", "unknown", NOW).level).toBe(0);
  });

  it("不再出现只做标记，不动档位", () => {
    recordGrade("thrive", "known", NOW);
    markRemoved("thrive", NOW);
    expect(readProgress().thrive).toEqual({ level: 1, dueAt: expect.any(String), removed: true, updatedAt: NOW.toISOString() });
  });

  it("撤销可以恢复成原状态，也可以直接删掉记录", () => {
    const memory = recordGrade("genuine", "known", NOW);
    restoreMemory("genuine", undefined);
    expect(readProgress().genuine).toBeUndefined();
    restoreMemory("genuine", memory);
    expect(readProgress().genuine).toEqual(memory);
  });

  it("存储里是坏数据时当作空进度，不抛异常", () => {
    window.localStorage.setItem(STUDY_STORAGE_KEY, JSON.stringify({ abandon: "坏了", subtle: { level: "x" } }));
    expect(readProgress()).toEqual({});
  });
});

describe("组本轮队列", () => {
  it("新学只挑没背过的，按词库顺序取前 N 个", () => {
    const progress: StudyProgress = { abandon: { level: 1, dueAt: daysAgo(0), updatedAt: NOW.toISOString() } };
    expect(pickSessionWords(WORDS, progress, "new", 2, NOW)).toEqual(["subtle", "genuine"]);
  });

  it("复习只挑到期的，昨天和上个月到期的都算", () => {
    const progress: StudyProgress = {
      abandon: { level: 1, dueAt: daysAgo(1), updatedAt: NOW.toISOString() },
      subtle: { level: 3, dueAt: daysAgo(40), updatedAt: NOW.toISOString() },
      genuine: { level: 5, dueAt: "2027-01-01T00:00:00.000Z", updatedAt: NOW.toISOString() },
    };
    expect(pickSessionWords(WORDS, progress, "review", 10, NOW)).toEqual(["abandon", "subtle"]);
    expect(countDue(WORDS, progress, NOW)).toBe(2);
  });

  it("标记为不再出现的词不进任何队列", () => {
    const progress: StudyProgress = {
      abandon: { level: 2, dueAt: daysAgo(5), removed: true, updatedAt: NOW.toISOString() },
    };
    expect(pickSessionWords(WORDS, progress, "review", 10, NOW)).toEqual([]);
    expect(pickSessionWords(WORDS, progress, "new", 10, NOW)).toEqual(["subtle", "genuine", "thrive"]);
  });

  it("新学额度用完就返回空", () => {
    const progress: StudyProgress = Object.fromEntries(
      WORDS.map((word) => [word, { level: 1, dueAt: daysAgo(0), updatedAt: NOW.toISOString() }]),
    );
    expect(pickSessionWords(WORDS, progress, "new", 10, NOW)).toEqual([]);
  });
});

describe("进度条口径", () => {
  it("按背过的词数算，不再出现的也算背过", () => {
    const progress: StudyProgress = {
      abandon: { level: 1, dueAt: daysAgo(0), updatedAt: NOW.toISOString() },
      subtle: { level: 1, dueAt: daysAgo(0), removed: true, updatedAt: NOW.toISOString() },
    };
    expect(learnedRatio(WORDS, progress)).toBe(50);
  });

  it("空词库返回 0，不做除零", () => {
    expect(learnedRatio([], {})).toBe(0);
  });
});

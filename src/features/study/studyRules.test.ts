import { describe, expect, it } from "vitest";

import {
  createSession,
  currentItem,
  dueFrom,
  goBack,
  goNext,
  grade,
  intervalDays,
  isDue,
  nextLevel,
  removeCurrent,
  removeFromDoubleTap,
  reviseToUnknown,
  saveCurrent,
  stepBack,
  undoLast,
  type StudySession,
} from "./studyRules";

const WORDS = ["abandon", "subtle", "genuine", "thrive", "reluctant", "fragile", "scrutinize", "ambiguous"];

/** 只关心结构不关心内容时的简写：词 + 轮次 + 位置。 */
const shape = (session: StudySession) =>
  `${session.index}|${session.queue.length}|${session.queue.map((item) => `${item.word}#${item.round}`).join(",")}`;

const statsOf = (session: StudySession) => Object.values(session.stats).join("/");

describe("档位与间隔", () => {
  it("认识升一级，最高停在 L7", () => {
    expect(nextLevel(0, "known")).toBe(1);
    expect(nextLevel(3, "known")).toBe(4);
    expect(nextLevel(7, "known")).toBe(7);
  });

  it("不确定档位不动", () => {
    expect(nextLevel(4, "unsure")).toBe(4);
  });

  it("不认识退两级，最低到 0", () => {
    expect(nextLevel(5, "unknown")).toBe(3);
    expect(nextLevel(1, "unknown")).toBe(0);
  });

  it("间隔跟着档位走，不确定减半，不认识本轮回炉", () => {
    expect(intervalDays(1, "known")).toBe(1);
    expect(intervalDays(4, "known")).toBe(16);
    expect(intervalDays(7, "known")).toBe(180);
    expect(intervalDays(4, "unsure")).toBe(8);
    expect(intervalDays(1, "unsure")).toBe(1);
    expect(intervalDays(4, "unknown")).toBe(0);
  });
});

describe("到期判定", () => {
  const now = new Date("2026-10-14T09:00:00+08:00");

  it("今天到期算到期", () => {
    expect(isDue(dueFrom(now, 0), now)).toBe(true);
  });

  it("几天前到期的也算，不会丢", () => {
    expect(isDue("2026-10-10T09:00:00+08:00", now)).toBe(true);
    expect(isDue("2026-09-01T09:00:00+08:00", now)).toBe(true);
  });

  it("还没到期的不算", () => {
    expect(isDue("2026-10-15T09:00:00+08:00", now)).toBe(false);
  });

  it("没有到期时间或时间非法时都不算到期", () => {
    expect(isDue(null, now)).toBe(false);
    expect(isDue("", now)).toBe(false);
    expect(isDue("不是时间", now)).toBe(false);
  });
});

describe("本轮队列", () => {
  it("按给定顺序取前 N 个，都是从第 1 轮开始", () => {
    const session = createSession(WORDS, 3);
    expect(session.queue).toEqual([
      { word: "abandon", round: 1 },
      { word: "subtle", round: 1 },
      { word: "genuine", round: 1 },
    ]);
    expect(session.stage).toBe("recall");
    expect(currentItem(session)?.word).toBe("abandon");
  });

  it("答对进入释义态并留下一条记录", () => {
    const session = grade(createSession(WORDS, 3), "known");
    expect(session.stage).toBe("reveal");
    expect(session.history).toHaveLength(1);
    expect(session.stats.known).toBe(1);
    expect(session.queue).toHaveLength(3);
  });

  it("答错在 4 个词之后回炉一次", () => {
    const session = grade(createSession(WORDS, 8), "unknown");
    expect(session.queue).toHaveLength(9);
    expect(session.queue[5]).toEqual({ word: "abandon", round: 2 });
  });

  it("同一个词回炉后不再插第二次", () => {
    const session = createSession(WORDS, 8);
    grade(session, "unknown");
    session.index = 5; // 走到回炉副本上
    expect(currentItem(session)).toEqual({ word: "abandon", round: 2 });
    grade(session, "unknown");
    expect(session.queue.filter((item) => item.word === "abandon")).toHaveLength(2);
  });
});

describe("释义态的记错了", () => {
  it("把这次判定改写成不认识，不新开记录", () => {
    const session = grade(createSession(WORDS, 8), "unsure");
    expect(session.stats.unsure).toBe(1);
    reviseToUnknown(session);
    expect(session.stats.unsure).toBe(0);
    expect(session.stats.unknown).toBe(1);
    expect(session.history).toHaveLength(1);
    expect(session.queue).toHaveLength(9);
  });

  it("连按多次不会重复计数或重复回炉", () => {
    const session = grade(createSession(WORDS, 8), "known");
    reviseToUnknown(session);
    reviseToUnknown(session);
    reviseToUnknown(session);
    expect(session.stats.unknown).toBe(1);
    expect(session.stats.known).toBe(0);
    expect(session.queue).toHaveLength(9);
    expect(session.history).toHaveLength(1);
  });
});

describe("不再出现与加入生词本", () => {
  it("卡片态不再出现：移出队列并前进", () => {
    const session = removeCurrent(createSession(WORDS, 4));
    expect(session.stats.removed).toBe(1);
    expect(session.queue).toHaveLength(3);
    expect(currentItem(session)?.word).toBe("subtle");
  });

  it("释义态按不再出现：先撤掉刚才的判定，不残留认识", () => {
    const session = grade(createSession(WORDS, 4), "known");
    removeCurrent(session);
    expect(session.stats.known).toBe(0);
    expect(session.stats.removed).toBe(1);
    expect(session.history).toHaveLength(1);
    expect(session.queue.map((item) => item.word)).not.toContain("abandon");
  });

  it("加入生词本和不认识一样展开释义并回炉", () => {
    const session = saveCurrent(createSession(WORDS, 8));
    expect(session.stats.saved).toBe(1);
    expect(session.stats.unknown).toBe(1);
    expect(session.queue).toHaveLength(9);
    expect(session.queue[5]).toEqual({ word: "abandon", round: 2 });
    expect(session.index).toBe(0);
    expect(session.stage).toBe("reveal");
    expect(session.history[0]).toMatchObject({ action: "saved", insertedAt: 5, savedWord: "abandon" });
  });

  it("没展开释义时双击右键，直接移出这张卡对应的词", () => {
    const session = createSession(WORDS, 4);
    grade(session, "known");
    removeFromDoubleTap(session, "known");
    expect(session.queue.map((item) => item.word)).not.toContain("abandon");
    expect(session.stats.known).toBe(0);
    expect(session.stats.removed).toBe(1);
  });

  it("展开释义后双击右键，移出的仍是这张卡对应的词", () => {
    const session = createSession(WORDS, 4);
    grade(session, "known");
    session.index += 1; // 单击右键已经翻到下一张
    removeFromDoubleTap(session, "next");
    expect(session.queue.map((item) => item.word)).toEqual(["subtle", "genuine", "thrive"]);
    expect(currentItem(session)?.word).toBe("subtle");
  });
});

describe("撤销与回退", () => {
  it("← 单击只回到本词的卡片态", () => {
    const session = grade(createSession(WORDS, 4), "known");
    goBack(session);
    expect(session.stage).toBe("recall");
    expect(session.index).toBe(0);
    expect(currentItem(session)?.word).toBe("abandon");
    expect(session.stats.known).toBe(0);
  });

  it("← 双击退回上一个已作答的词", () => {
    const session = createSession(WORDS, 4);
    grade(session, "known");
    goNext(session);
    grade(session, "known");
    goNext(session);
    stepBack(session);
    expect(currentItem(session)?.word).toBe("subtle");
    expect(session.stage).toBe("recall");
    expect(session.stats.known).toBe(1);
  });

  it("在第一个词上双击不越界", () => {
    const session = createSession(WORDS, 4);
    stepBack(session);
    expect(session.index).toBe(0);
    expect(session.history).toHaveLength(0);
  });

  it("一路退回去之后统计归零、队列复原", () => {
    const session = createSession(WORDS, 8);
    const origin = shape(session);
    grade(session, "known");
    session.index = 1;
    grade(session, "unknown");
    session.index = 2;
    saveCurrent(session);
    removeCurrent(session);
    while (session.history.length > 0) stepBack(session);
    expect(statsOf(session)).toBe("0/0/0/0/0");
    expect(shape(session)).toBe(origin);
  });

  it("撤销没有记录时返回 undefined，不改动会话", () => {
    const session = createSession(WORDS, 4);
    expect(undoLast(session)).toBeUndefined();
    expect(session.index).toBe(0);
  });
});

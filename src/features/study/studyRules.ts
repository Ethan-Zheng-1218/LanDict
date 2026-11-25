/**
 * 背单词的规则层：档位、间隔、队列、判定。纯函数，不碰界面也不碰存储，方便单测。
 *
 * 规则口径见 `design-previews/word-study-notes.md`：
 * 每个词一个记忆档位 L1–L7，间隔 1/3/7/16/35/75/180 天；
 * 认识升一级，不确定档位不动但间隔减半，不认识退两级并在本轮回炉一次，
 * 「不再出现」不参与档位；「加入生词本」和不认识一样退两级、回炉，同时把词收进生词本。
 */

/** L1–L7 的间隔（天）。下标 0 对应 L1。 */
export const LADDER_DAYS = [1, 3, 7, 16, 35, 75, 180] as const;

/** 答错后隔几个词再考一次。 */
export const RELEARN_GAP = 4;

/** 同一个方向键两次按下的间隔小于这个毫秒数就算双击。 */
export const DOUBLE_TAP_MS = 300;

/** 卡片态的四个动作。 */
export type StudyAction = "unknown" | "unsure" | "known" | "removed" | "saved";

/** 参与档位升降的三个评级动作。 */
export type GradeAction = "unknown" | "unsure" | "known";

export const LADDER_MAX_LEVEL = LADDER_DAYS.length;

export function isGradeAction(action: StudyAction): action is GradeAction {
  return action === "unknown" || action === "unsure" || action === "known";
}

/** 判定之后的档位。0 表示还没背过的新词。 */
export function nextLevel(level: number, action: GradeAction): number {
  if (action === "known") return Math.min(LADDER_MAX_LEVEL, level + 1);
  if (action === "unsure") return level;
  return Math.max(0, level - 2);
}

/**
 * 判定之后下次出现的间隔（天）。
 * 认识按新档位；不确定档位不动但间隔减半（提前回来一次）；
 * 不认识不进正常间隔，它在**本轮**里回炉，所以返回 0。
 */
export function intervalDays(level: number, action: GradeAction): number {
  if (action === "unknown") return 0;
  const days = LADDER_DAYS[Math.max(0, Math.min(LADDER_MAX_LEVEL, level) - 1)] ?? 0;
  if (action === "unsure") return Math.max(1, Math.round(days / 2));
  return days;
}

/** 下次到期时间。间隔为 0（本轮回炉）时返回当天。 */
export function dueFrom(now: Date, days: number): string {
  const due = new Date(now.getTime());
  due.setDate(due.getDate() + days);
  return due.toISOString();
}

/**
 * 复习队列取「下次到期时间 ≤ 今天」的全部条目。隔了几天没学，之前到期的会一起排进来，
 * 不会丢；所以调用方看到的数字可能远大于"今天到期"的量。
 */
export function isDue(dueAt: string | null | undefined, now: Date): boolean {
  if (!dueAt) return false;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return false;
  const endOfToday = new Date(now.getTime());
  endOfToday.setHours(23, 59, 59, 999);
  return due.getTime() <= endOfToday.getTime();
}

/** 本轮队列里的一条。round 2 表示这是回炉后的第二次出现。 */
export type QueueItem = { word: string; round: number };

export function buildQueue(words: readonly string[], size: number): QueueItem[] {
  return words.slice(0, Math.max(0, size)).map((word) => ({ word, round: 1 }));
}

/** 回炉副本插到哪：当前词之后第 RELEARN_GAP 个位置。 */
export function relearnPosition(index: number, length: number): number {
  return Math.min(index + RELEARN_GAP + 1, length);
}

export function isFinished(index: number, length: number): boolean {
  return index >= length;
}

/** 一次作答的记录。撤销（← 单击 / 双击回退）都靠它。 */
export type StudyStep = {
  index: number;
  /** 这一步作用在哪个词上。队列会因移出/回炉而变位，所以记录里必须自带词，不能只存下标。 */
  word: string;
  action: StudyAction;
  /** 不认识时回炉副本插入的位置；没插就是 -1。 */
  insertedAt: number;
  /** 「不再出现」移出的词，撤销时要放回去。 */
  removedWord?: string;
  /** 「加入生词本」加进去的词，撤销时要从生词本里撤回。 */
  savedWord?: string;
};

export type StudyStats = Record<StudyAction, number>;

export type StudySession = {
  /** 本轮的全部队列（含回炉副本），拍平成固定顺序，index 指向当前。 */
  queue: QueueItem[];
  index: number;
  /** recall = 只看单词；reveal = 已展开释义。 */
  stage: "recall" | "reveal";
  history: StudyStep[];
  stats: StudyStats;
};

export const EMPTY_STATS: StudyStats = { known: 0, unsure: 0, unknown: 0, removed: 0, saved: 0 };

export function createSession(words: readonly string[], size: number): StudySession {
  return { queue: buildQueue(words, size), index: 0, stage: "recall", history: [], stats: { ...EMPTY_STATS } };
}

export function currentItem(session: StudySession): QueueItem | undefined {
  return session.queue[session.index];
}

export function isRevealed(session: StudySession): boolean {
  return session.stage === "reveal";
}

function pushStep(session: StudySession, step: StudyStep): void {
  session.history.push(step);
}

/**
 * 卡片态的判定。会改传入的 session（内存里的会话对象，不外传），返回它本身便于链式调用。
 */
export function grade(session: StudySession, action: GradeAction): StudySession {
  const at = session.index;
  const item = session.queue[at];
  if (!item) return session;
  session.stats[action] += 1;
  let insertedAt = -1;
  if (action === "unknown" && item.round < 2) {
    insertedAt = relearnPosition(at, session.queue.length);
    session.queue.splice(insertedAt, 0, { word: item.word, round: item.round + 1 });
  }
  pushStep(session, { index: at, word: item.word, action, insertedAt });
  session.stage = "reveal";
  return session;
}

/**
 * 释义态的「记错了」：把这一次判定改写成不认识，不新开一条记录。
 * 已经是"不认识"时原样返回，所以连按多次也不会重复计数或重复回炉。
 */
export function reviseToUnknown(session: StudySession): StudySession {
  const at = session.index;
  const last = session.history[session.history.length - 1];
  if (!last || last.index !== at || last.action === "unknown" || last.action === "saved") return session;
  const item = session.queue[at];
  session.stats[last.action] = Math.max(0, session.stats[last.action] - 1);
  session.stats.unknown += 1;
  if (item && item.round < 2) {
    last.insertedAt = relearnPosition(at, session.queue.length);
    session.queue.splice(last.insertedAt, 0, { word: item.word, round: item.round + 1 });
  }
  last.action = "unknown";
  if (item) last.word = item.word;
  return session;
}

/** 「不再出现」：标为不再出现并从队列里移出，然后前进。 */
export function removeCurrent(session: StudySession): StudySession {
  const at = session.index;
  const item = session.queue[at];
  if (!item) return session;
  // 释义态按的：先撤掉这个词刚才的判定，它算"移出"而不是"认识"。
  const last = session.history[session.history.length - 1];
  if (session.stage === "reveal" && last && last.index === at) undoLast(session);
  session.stats.removed += 1;
  session.queue.splice(at, 1);
  session.history.push({ index: at, word: item.word, action: "removed", insertedAt: -1, removedWord: item.word });
  session.stage = "recall";
  return session;
}

/** 「加入生词本」：收进生词本，并按不认识的规则展开释义、退两级且本轮回炉。 */
export function saveCurrent(session: StudySession): StudySession {
  const at = session.index;
  const item = session.queue[at];
  if (!item) return session;
  session.stats.saved += 1;
  session.stats.unknown += 1;
  const insertedAt = item.round < 2 ? relearnPosition(at, session.queue.length) : -1;
  if (insertedAt >= 0) session.queue.splice(insertedAt, 0, { word: item.word, round: item.round + 1 });
  session.history.push({ index: at, word: item.word, action: "saved", insertedAt, savedWord: item.word });
  session.stage = "reveal";
  return session;
}

/** 释义态的「下一个单词」。 */
export function goNext(session: StudySession): StudySession {
  session.index += 1;
  session.stage = "recall";
  return session;
}

/** 撤销最近一次作答，回到那个词的卡片态。返回被撤销的记录。 */
export function undoLast(session: StudySession): StudyStep | undefined {
  const step = session.history.pop();
  if (!step) return undefined;
  if (step.action === "removed" && step.removedWord !== undefined) {
    session.stats.removed = Math.max(0, session.stats.removed - 1);
    session.queue.splice(step.index, 0, { word: step.removedWord, round: 1 });
  } else if (step.action === "saved") {
    session.stats.saved = Math.max(0, session.stats.saved - 1);
    session.stats.unknown = Math.max(0, session.stats.unknown - 1);
    if (step.insertedAt >= 0) session.queue.splice(step.insertedAt, 1);
  } else {
    session.stats[step.action] = Math.max(0, session.stats[step.action] - 1);
    if (step.insertedAt >= 0) session.queue.splice(step.insertedAt, 1);
  }
  session.index = step.index;
  session.stage = "recall";
  return step;
}

/** ← 单击（释义态）：回到卡片重答，不换词。 */
export function goBack(session: StudySession): StudySession {
  if (session.stage !== "reveal") return session;
  undoLast(session);
  return session;
}

/** ← 双击：退回上一个已作答的词。 */
export function stepBack(session: StudySession): StudySession {
  if (session.stage === "reveal") undoLast(session);
  if (session.history.length > 0) undoLast(session);
  return session;
}

/**
 * 双击 →：把这张卡对应的词标为不再出现。
 * 单击可能已经把它评成"认识"（卡片态）或翻到下一张（释义态），先撤回那一步。
 */
export function removeFromDoubleTap(session: StudySession, singleAction: "known" | "next" | null): StudySession {
  if (singleAction === "next") {
    session.index = Math.max(0, session.index - 1);
    session.stage = "reveal";
  } else if (singleAction === "known") {
    undoLast(session);
  }
  return removeCurrent(session);
}

/**
 * 背单词页。界面按 `design-previews/word-study-preview.html` 实现，样式在 `styles/study.css`
 * （外壳仍由 AppFrame 提供，这里只画内容列）。
 *
 * 三个屏幕：首页（学习内容 + 两张模式卡）→ 学习会话（卡片 / 释义）→ 本轮小结，
 * 另外有一个复习节奏抽屉。规则与队列在 studyRules，进度落盘在 studyStore，
 * 词条释义走应用既有的查词链路，本文件只负责交互与呈现。
 */

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { createDictionaryApi } from "@/features/translation/dictionaryProvider";
import { resolveWordQuery } from "@/features/translation/dictionaryResolver";
import {
  fetchWordPronunciation,
  pronunciationAudioLabel,
  type PronunciationAudioSource,
  type PronunciationIpaSource,
  type WordPronunciation,
} from "@/features/translation/pronunciationService";
import { getReadingVoiceAccent } from "@/features/settings/settingsStore";
import { listVocabulary, saveVocabulary, useVocabulary } from "@/features/vocabulary/vocabularyStore";
import { dedupeMeaningText } from "@/lib/meaningText";

import { playPronunciation, preloadPronunciationAudio, pronounceNow, stopPronunciation } from "./studySpeech";

import {
  createSession,
  currentItem,
  DOUBLE_TAP_MS,
  goBack,
  goNext,
  grade,
  intervalDays,
  isFinished,
  isGradeAction,
  isRevealed,
  LADDER_DAYS,
  nextLevel,
  RELEARN_GAP,
  removeFromDoubleTap,
  reviseToUnknown,
  saveCurrent,
  stepBack,
  type GradeAction,
  type StudySession,
} from "./studyRules";
import {
  ALL_BOOKS,
  applySessionProgress,
  countDue,
  dueBreakdown,
  learnedCount,
  learnedRatio,
  loadWordbookDetail,
  loadWordbooks,
  pendingCount,
  PHRASE_BOOKS,
  pickSessionWords,
  useProgress,
  VOCAB_SOURCE,
  WORD_BOOKS,
  writeProgress,
  type StudyMode,
  type StudyProgress,
  type StudySource,
  type WordbookDetail,
} from "./studyStore";

const DAILY_CHOICES = [10, 20, 30, 50] as const;

/** 每个词性只摆前 4 条义项：背单词要的是重点，不是把词典抄一遍。 */
const MEANING_PER_GROUP = 4;

/** 义项之间的分隔符。各条义项自己的标点保持词典原样，不重写。 */
const MEANING_SEPARATOR = "；";

/** 预估用时：新学每个词约 15 秒，复习每个词约 13 秒。 */
const NEW_SECONDS_PER_WORD = 15;
const REVIEW_SECONDS_PER_WORD = 13;

type Screen = "home" | "session" | "done";

/** 一张卡需要的全部资料。查不到的部分留空，界面按空处理。 */
type Card = {
  pos: string;
  /** 拍平的中文释义，写生词本和兜底显示用。 */
  meaning: string;
  /** 按词性分组的义项：单词来自牛津，词组就是一条中文释义。 */
  meaningGroups: { pos: string; items: string[] }[];
  /** 词组才有：牛津给的英文解释。 */
  english?: string;
  uk: string;
  us: string;
  ukAudio?: string;
  usAudio?: string;
  ukIpaSource: PronunciationIpaSource;
  usIpaSource: PronunciationIpaSource;
  ukAudioSource: PronunciationAudioSource;
  usAudioSource: PronunciationAudioSource;
  examples: { en: string; cn: string }[];
  collocations: { text: string; cn: string }[];
};

const EMPTY_CARD: Card = {
  pos: "",
  meaning: "",
  meaningGroups: [],
  uk: "",
  us: "",
  ukIpaSource: "fallback",
  usIpaSource: "fallback",
  ukAudioSource: "system-tts",
  usAudioSource: "system-tts",
  examples: [],
  collocations: [],
};

const KIND_LABEL: Record<StudySource["group"], string> = { book: "词库", phrase: "词组库", vocab: "" };

/** 词组卡片上那个小标签：习语 / 搭配 / 词条。 */
const PHRASE_POS_LABEL: Record<string, string> = { idiom: "习语", colloc: "搭配", multiword: "词条" };

function sourceName(source: StudySource): string {
  return source.group === "vocab" ? source.name : `${source.name}${KIND_LABEL[source.group]}`;
}

function hasSpace(word: string): boolean {
  return /\s/u.test(word);
}

/**
 * 「小键盘左/右」在键盘上有两种送键方式：数字锁关着时小键盘就是方向键（ArrowLeft），
 * 开着时是数字键（不过 code 依然是 Numpad4 / Numpad6）。两种都认。
 */
function isBackKey(event: KeyboardEvent): boolean {
  return event.key === "ArrowLeft" || event.code === "Numpad4";
}

function isForwardKey(event: KeyboardEvent): boolean {
  return event.key === "ArrowRight" || event.code === "Numpad6";
}

/** 生词本里存过的释义和音标可以兜底：查词链路取不到时至少还有它。 */
function localCard(word: string): Card | undefined {
  const key = word.toLowerCase();
  const entry = listVocabulary().find((item) => item.word === key);
  if (!entry) return undefined;
  return {
    ...EMPTY_CARD,
    meaning: entry.meaning,
    meaningGroups: entry.meaning ? [{ pos: entry.partOfSpeech || "释义", items: [entry.meaning] }] : [],
    pos: entry.partOfSpeech,
    uk: ipa(entry.phonetic),
  };
}

/** 词组卡片：释义和例句来自生成词组库时一起写进去的那两份数据。 */
function phraseCard(phrase: string, posLabel: string, detail: WordbookDetail): Card {
  const meaning = detail.meanings[phrase] ?? {};
  const example = detail.examples[phrase];
  const items = (meaning.cn ?? "").split(/[；;]/).map((item) => item.trim()).filter(Boolean);
  return {
    ...EMPTY_CARD,
    pos: posLabel,
    meaning: meaning.cn ?? "",
    meaningGroups: items.length ? [{ pos: posLabel, items }] : [],
    ...(meaning.en ? { english: meaning.en } : {}),
    ...(example?.en ? { examples: [{ en: example.en, cn: example.cn ?? "" }] } : {}),
  };
}

/**
 * 卡片自己负责画那两个斜杠，所以这里把服务给的 `/…/` 剥掉；
 * 占位符「—」和牛津那种只给出差别的半截音标（`/-vərn-/`）都不当内容用。
 */
function ipa(value: string | undefined): string {
  const text = (value ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!text || text === "—") return "";
  return /^-/.test(text) ? "" : text;
}

/** 把发音服务的结果摊平成卡片上的几个字段。 */
function pronunciationFields(pronunciation: WordPronunciation): Partial<Card> {
  return {
    uk: ipa(pronunciation.british.ipa),
    us: ipa(pronunciation.american.ipa),
    ...(pronunciation.british.audioUrl ? { ukAudio: pronunciation.british.audioUrl } : {}),
    ...(pronunciation.american.audioUrl ? { usAudio: pronunciation.american.audioUrl } : {}),
    ukIpaSource: pronunciation.british.ipaSource,
    usIpaSource: pronunciation.american.ipaSource,
    ukAudioSource: pronunciation.british.audioSource,
    usAudioSource: pronunciation.american.audioSource,
  };
}

/** 卡片资料到位后再补一次：音频要联网，不能让它挡住释义。 */
type CardPatch = (word: string, patch: Partial<Card>) => void;

/**
 * 释义、例句、搭配和音标都走应用既有的查词链路（策略层 dictionaryResolver）：
 * 牛津精确 → 牛津经词形还原 → 精简 ECDICT，音标按平台各走各的原路。
 * 这样 `later` 这类词形变化也能落到 `late` 的词条上。
 */
async function loadCard(word: string, signal: AbortSignal, patch?: CardPatch, phrase?: { posLabel: string; detail: WordbookDetail }): Promise<Card> {
  const local = localCard(word);
  // 带空格的短语没法查本地词库（接口只收单个英文词），释义和例句用生成词组库时存好的那份。
  if (hasSpace(word)) return phrase ? phraseCard(word, phrase.posLabel, phrase.detail) : (local ?? EMPTY_CARD);
  // 音标和音频走发音服务：英式牛津音标 + 免费音频，美式牛津音标 + 韦氏音频，缺了才退到系统语音。
  // 传了补丁回调时它先给本地的结果、联网的那份稍后回调，所以释义不会被联网拖住。
  const [result, pronunciation] = await Promise.all([
    resolveWordQuery(word, createDictionaryApi(), signal).catch(() => undefined),
    fetchWordPronunciation(word, signal, (full) => patch?.(word, pronunciationFields(full))).catch(() => undefined),
  ]);
  if (signal.aborted) return local ?? EMPTY_CARD;
  const entry = result?.status === "success" ? result.entries[0] : undefined;
  if (!entry && !pronunciation) return local ?? EMPTY_CARD;
  const meaning = entry?.meanings.flatMap((item) => item.translations).join("；") ?? "";
  const translations = entry?.collocationTranslations ?? {};
  const fields = pronunciation ? pronunciationFields(pronunciation) : {};
  /* 顺手把音频预热：等到展开释义时就不必再等下载。 */
  preloadPronunciationAudio(fields.ukAudio);
  preloadPronunciationAudio(fields.usAudio);
  return {
    ...fields,
    pos: entry?.partOfSpeech || local?.pos || "",
    meaning: meaning ? dedupeMeaningText(meaning) : (local?.meaning ?? ""),
    meaningGroups: (entry?.meanings ?? [])
      .map((group) => ({ pos: group.partOfSpeech || "释义", items: group.translations.filter(Boolean) }))
      .filter((group) => group.items.length > 0),
    uk: fields.uk || ipa(entry?.britishPhonetic) || local?.uk || "",
    us: fields.us || ipa(entry?.americanPhonetic),
    ukIpaSource: fields.ukIpaSource ?? "fallback",
    usIpaSource: fields.usIpaSource ?? "fallback",
    ukAudioSource: fields.ukAudioSource ?? "system-tts",
    usAudioSource: fields.usAudioSource ?? "system-tts",
    examples: (entry?.examples ?? []).slice(0, 2).map((example) => ({ en: example.text, cn: example.translation ?? "" })),
    collocations: (entry?.collocations ?? []).slice(0, 4).map((text) => ({ text, cn: translations[text] ?? "" })),
  };
}

/** 发音按钮上的来源说明：音标来自哪份库，音频来自哪一路。 */
function pronunciationTitle(accent: "uk" | "us", ipaSource: PronunciationIpaSource, audioSource: PronunciationAudioSource) {
  const ipaLabel = ipaSource === "oxford" ? "牛津音标" : ipaSource === "youdao" ? "有道音标" : "备用音标";
  return `${ipaLabel} · ${pronunciationAudioLabel(audioSource, accent)}`;
}

/**
 * 取一轮的卡片资料。一次只发 4 个词的请求：20 个词一起打过去时，
 * 本地词库偶尔会漏掉几条，卡片就变成空的。
 */
async function loadCards(
  words: readonly string[],
  signal: AbortSignal,
  patch?: CardPatch,
  phrase?: { posLabel: string; detail: WordbookDetail },
): Promise<Record<string, Card>> {
  const pending = [...words];
  const loaded: Record<string, Card> = {};
  const worker = async () => {
    for (let word = pending.shift(); word !== undefined; word = pending.shift()) {
      loaded[word] = await loadCard(word, signal, patch, phrase);
      if (signal.aborted) return;
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
  return loaded;
}

/* ── 图标：几何与描边照预览里的内联 SVG，不额外引入图标集 ── */

function ExitIcon() {
  return <svg viewBox="0 0 16 16"><path d="M9.8 3.4 5.2 8l4.6 4.6" /><path d="M5.2 8h7" /></svg>;
}

function CloseIcon() {
  return <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" /></svg>;
}

function ReviewModeIcon() {
  return <svg viewBox="0 0 16 16"><path d="M13.4 8a5.4 5.4 0 1 1-1.9-4.1" /><path d="M13.6 2.6v3.2h-3.2" /></svg>;
}

function CheckIcon() {
  return <svg viewBox="0 0 16 16"><path d="M3.6 8.4 6.4 11.2 12.4 5" /></svg>;
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 16 16">
      <path d="M3.5 6.2h2l2.6-2.1v7.8L5.5 9.8h-2z" />
      <path d="M10.6 5.9a3 3 0 0 1 0 4.2" />
    </svg>
  );
}

function Row({ label, children, grid = false }: { label: string; children: ReactNode; grid?: boolean }) {
  return (
    <div className={`study-source-row${grid ? " study-source-row-grid" : ""}`}>
      <div className="study-source-label">{label}</div>
      <div className={`study-chips${grid ? " study-chip-grid" : ""}`}>{children}</div>
    </div>
  );
}

export function StudyPage() {
  const navigate = useNavigate();
  const progress = useProgress();
  const vocabulary = useVocabulary();
  const [view, setView] = useState<Screen>("home");
  const [sourceId, setSourceId] = useState(WORD_BOOKS[0].id);
  const [daily, setDaily] = useState(20);
  const [books, setBooks] = useState<Record<string, string[]>>({});
  const [booksReady, setBooksReady] = useState(false);
  const [cards, setCards] = useState<Record<string, Card>>({});
  const [notice, setNotice] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<StudyMode>("new");
  const [, rerender] = useReducer((tick: number) => tick + 1, 0);

  const sessionRef = useRef<StudySession | null>(null);
  const baseRef = useRef<StudyProgress>({});
  /** 进这一轮时的到期条数，小结里要拿它算「明天要复习多少」。 */
  const dueAtStartRef = useRef(0);
  /** 上一次按方向键的时间戳，0 表示双击窗口已关闭。左右各记一份。 */
  const lastLeftAt = useRef(0);
  const lastRightAt = useRef(0);
  /** 单击 → 做了什么（卡片态的认识 / 释义态的下一个），双击时要撤回它。 */
  const rightAction = useRef<"known" | "next" | null>(null);

  const source = useMemo(
    () => (sourceId === VOCAB_SOURCE.id ? VOCAB_SOURCE : ALL_BOOKS.find((book) => book.id === sourceId) ?? WORD_BOOKS[0]),
    [sourceId],
  );
  const isVocab = source.group === "vocab";
  const vocabWords = useMemo(() => vocabulary.map((entry) => entry.word), [vocabulary]);
  const words = isVocab ? vocabWords : books[source.id] ?? [];

  /* 首页每个 chip 都要显示词条数和已背比例，所以一次把全部词库读回来。 */
  useEffect(() => {
    const controller = new AbortController();
    void loadWordbooks(ALL_BOOKS.map((book) => book.id), controller.signal).then((loaded) => {
      if (controller.signal.aborted) return;
      setBooks(loaded);
      setBooksReady(true);
    });
    return () => controller.abort();
  }, []);

  const total = words.length;
  const learned = learnedCount(words, progress);
  const percent = learnedRatio(words, progress);
  const due = countDue(words, progress);
  const { overdue } = dueBreakdown(words, progress);
  const newCount = Math.min(daily, isVocab ? pendingCount(words, progress) : Math.max(0, total - learned));
  const message = notice || (!isVocab && booksReady && !total ? "词库没加载出来，刷新页面再试。" : "");

  /** 一次会话动作：跑引擎 → 按本轮记录整体重算记忆 → 需要时写生词本。 */
  const act = useCallback(
    (run: (session: StudySession) => void) => {
      const session = sessionRef.current;
      if (!session) return;
      const historyLength = session.history.length;
      run(session);
      writeProgress(applySessionProgress(baseRef.current, session.history));
      const last = session.history[session.history.length - 1];
      if (session.history.length > historyLength && last?.action === "saved") {
        saveVocabulary({
          word: last.word,
          meaning: cards[last.word]?.meaning || "待补充释义",
          phonetic: cards[last.word]?.uk ?? "",
          source: "背单词",
          sourceType: "lookup",
        });
      }
      rerender();
      if (isFinished(session.index, session.queue.length)) setView("done");
    },
    [cards],
  );

  const start = useCallback(
    (nextMode: StudyMode) => {
      const picked = pickSessionWords(words, progress, nextMode, nextMode === "new" ? daily : Number.MAX_SAFE_INTEGER);
      if (!picked.length) {
        setNotice(nextMode === "new" ? "这个词库已经背完了。" : "现在没有到期的词。");
        return;
      }
      setNotice("");
      setMode(nextMode);
      baseRef.current = progress;
      dueAtStartRef.current = countDue(words, progress);
      sessionRef.current = createSession(picked, picked.length);
      lastLeftAt.current = 0;
      lastRightAt.current = 0;
      rightAction.current = null;
      setView("session");
      rerender();
      const controller = new AbortController();
      /* 音频要联网，晚一步到：到了就补进对应的卡片，不动别的词。 */
      const patchCard: CardPatch = (word, patch) => {
        if (controller.signal.aborted) return;
        preloadPronunciationAudio(patch.ukAudio);
        preloadPronunciationAudio(patch.usAudio);
        setCards((current) => (current[word] ? { ...current, [word]: { ...current[word], ...patch } } : current));
      };
      void (async () => {
        /* 词组书的释义和例句在生成时就写进 JSON 了，先把它读进来再取卡片。 */
        const phrase = source.group === "phrase"
          ? { posLabel: PHRASE_POS_LABEL[source.id] ?? "词组", detail: await loadWordbookDetail(source.id, controller.signal) }
          : undefined;
        if (controller.signal.aborted) return;
        const loaded = await loadCards(picked, controller.signal, patchCard, phrase);
        if (controller.signal.aborted) return;
        setCards((current) => ({ ...current, ...loaded }));
      })();
    },
    [daily, progress, words],
  );

  const runSlot = useCallback(
    (session: StudySession, slot: "left" | "down" | "right") => {
      if (session.stage === "recall") {
        grade(session, slot === "left" ? "unknown" : slot === "down" ? "unsure" : "known");
        return;
      }
      if (slot === "left") goBack(session);
      else if (slot === "down") reviseToUnknown(session);
      else goNext(session);
    },
    [],
  );

  /* 小结页的两个动作：方向键 / 小键盘左右 —— 左边返回主界面，右边再来一组。 */
  useEffect(() => {
    if (view !== "done") return;
    const onKey = (event: KeyboardEvent) => {
      if (isBackKey(event)) {
        event.preventDefault();
        setView("home");
      } else if (isForwardKey(event)) {
        event.preventDefault();
        start(mode);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, start, view]);

  useEffect(() => {
    if (view !== "session") return;
    const onKey = (event: KeyboardEvent) => {
      const session = sessionRef.current;
      if (!session) return;
      const now = Date.now();
      const key = event.key;
      if (key === "Escape") {
        setView("home");
        return;
      }
      if (key === " " || key === "Spacebar") {
        event.preventDefault();
        const current = currentItem(session);
        if (current) playPronunciation(current.word, "en-GB", cardsRef.current[current.word]?.ukAudio);
        return;
      }
      /* 方向键要区分单击和双击：单击立刻生效，300ms 内又来一次就把它撤回，改做双击的动作。 */
      if (isBackKey(event)) {
        event.preventDefault();
        const doubled = lastLeftAt.current > 0 && now - lastLeftAt.current <= DOUBLE_TAP_MS;
        lastLeftAt.current = doubled ? 0 : now;
        act((target) => {
          if (doubled) stepBack(target);
          else runSlot(target, "left");
        });
        return;
      }
      if (isForwardKey(event)) {
        event.preventDefault();
        const doubled = lastRightAt.current > 0 && now - lastRightAt.current <= DOUBLE_TAP_MS;
        const single = rightAction.current;
        lastRightAt.current = doubled ? 0 : now;
        rightAction.current = doubled ? null : isRevealed(session) ? "next" : "known";
        act((target) => {
          if (doubled) removeFromDoubleTap(target, single);
          else runSlot(target, "right");
        });
        return;
      }
      /* 按了别的键就关掉双击窗口。 */
      lastLeftAt.current = 0;
      lastRightAt.current = 0;
      rightAction.current = null;
      if (key === "ArrowDown") {
        event.preventDefault();
        act((target) => runSlot(target, "down"));
      }
      if (key === "ArrowUp") {
        event.preventDefault();
        act((target) => saveCurrent(target));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act, runSlot, view]);

  const session = sessionRef.current;
  const item = session ? currentItem(session) : undefined;
  const revealed = session ? isRevealed(session) : false;
  const card = item ? cards[item.word] : undefined;
  const cardsRef = useRef(cards);

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  /**
   * 释义卡一出现就自动读一遍这个词。口音跟着设置页里的朗读口音走，
   * 预加载好的音频（英式免费音频 / 韦氏美式音频）已经能播就直接放，一步不等；
   * 还没下完就立刻用系统语音念，绝不为了等音频而没声音；
   * 收起释义或换到下一个词时把声音停掉。
   */
  useEffect(() => {
    if (view !== "session" || !revealed || !item) return;
    const accent = getReadingVoiceAccent();
    const current = cardsRef.current[item.word];
    pronounceNow(item.word, accent, { uk: current?.ukAudio, us: current?.usAudio });
    return () => stopPronunciation();
  }, [item?.word, revealed, view]);

  /* ── 学习会话 ── */

  if (view === "session" && session && item) {
    const step = session.history[session.history.length - 1];
    const lastAction = revealed && step && step.index === session.index ? step.action : null;
    const lastAnswer: GradeAction | null = lastAction && isGradeAction(lastAction) ? lastAction : null;
    /* 档位要按「答之前」算：这次判定已经写进进度了，直接读会把刚升的那一级再算一遍。 */
    const level = applySessionProgress(baseRef.current, session.history.slice(0, -1))[item.word.toLowerCase()]?.level ?? 0;
    const thing = source.group === "phrase" ? "这条短语" : "这个词";
    const labels = revealed
      ? { left: "上一步", down: "记错了", right: "下一个" }
      : { left: "不认识", down: "不确定", right: "认识" };
    const note = lastAnswer === "known"
      ? { kind: "known", title: "你选了「认识」", body: `答对，档位升一级：${thing} ${intervalDays(nextLevel(level, "known"), "known")} 天后再见` }
      : lastAnswer === "unsure"
        ? { kind: "unsure", title: "你选了「不确定」", body: `档位不动，间隔按一半算：${intervalDays(level, "unsure")} 天后再见，会排在前面` }
        : lastAnswer === "unknown"
          ? { kind: "unknown", title: "你选了「不认识」", body: `退两级，过 ${RELEARN_GAP} 个词这一轮还会再考一次` }
          : lastAction === "saved"
            ? { kind: "unknown", title: "已加入生词本", body: `退两级，过 ${RELEARN_GAP} 个词这一轮还会再考一次` }
            : { kind: "unknown", title: "你还没选", body: "" };
    const hasRight = card ? card.examples.length > 0 || card.collocations.length > 0 : false;
    const meaningGroups = (card?.meaningGroups ?? []).filter((group) => group.items.length > 0);

    return (
      <section className="study-page" aria-label="背单词">
        <div className="study-screen">
          <div className="study-session-head">
            <button aria-label="返回背单词主页" className="study-session-back" onClick={() => setView("home")} type="button">
              <ExitIcon /><span>返回</span>
            </button>
            <span className="study-step">第 {Math.min(session.index + 1, session.queue.length)} / {session.queue.length}</span>
            <div className="study-progress">
              <i style={{ width: `${session.queue.length ? Math.round((session.index / session.queue.length) * 100) : 0}%` }} />
            </div>
            <span className="study-book">{sourceName(source)} · {mode === "new" ? "背新单词" : "复习"}</span>
          </div>

          <div className={revealed ? "study-body revealed" : "study-body"}>
            <div className="study-group">
              <div className="study-word-zone">
                <div className={source.group === "phrase" ? "study-word phrase" : "study-word"}>{item.word}</div>
                {source.group !== "phrase" && (card?.uk || card?.us) ? (
                  <div className="study-phonetics">
                    <button
                      aria-label={`英式发音 ${card?.uk ?? ""}`}
                      className="study-phonetic-button"
                      onClick={() => playPronunciation(item.word, "en-GB", card?.ukAudio)}
                      title={pronunciationTitle("uk", card?.ukIpaSource ?? "fallback", card?.ukAudioSource ?? "system-tts")}
                      type="button"
                    >
                      <b>UK</b><SpeakerIcon />/{card?.uk ?? ""}/
                    </button>
                    <button
                      aria-label={`美式发音 ${card?.us || card?.uk || ""}`}
                      className="study-phonetic-button"
                      onClick={() => playPronunciation(item.word, "en-US", card?.usAudio)}
                      title={pronunciationTitle("us", card?.usIpaSource ?? "fallback", card?.usAudioSource ?? "system-tts")}
                      type="button"
                    >
                      <b>US</b><SpeakerIcon />/{card?.us || card?.uk || ""}/
                    </button>
                  </div>
                ) : null}
              </div>
              {/*
                释义只在展开态渲染：收起动画要跑 0.36 秒，如果这期间里面已经换成了下一个词的
                内容，用户就会先看到一眼新词的释义再等它收起来。留空壳、不画内容，收起就看不见了。
              */}
              <div className="study-meaning-zone">
                {revealed ? (
                  <>
                <div className="study-answer-note">
                  <span className={`study-tag ${note.kind}`}>{note.title}</span>
                  <span>{note.body}</span>
                </div>
                <div className={hasRight ? "study-meaning-card" : "study-meaning-card single"}>
                  <div className="study-meaning-left">
                    <div className="study-meaning-text">
                      {meaningGroups.length ? meaningGroups.map((group) => (
                        <div className="study-meaning-row" key={group.pos}>
                          {/* 词性只在行首出现一次；卡片上不再另挂一个词性标签 */}
                          <span className="study-meaning-pos">{group.pos === "释义" ? "" : group.pos}</span>
                          <p className="study-meaning-line">
                            {group.items.slice(0, MEANING_PER_GROUP).join(MEANING_SEPARATOR)}
                          </p>
                        </div>
                      )) : <p className="study-meaning-line">{card?.meaning || "本地词库暂未收录释义。"}</p>}
                    </div>
                  </div>
                  {hasRight && card ? (
                    <div className="study-meaning-right">
                      {card.english ? (
                        <div className="study-sect">
                          <h4 className="study-sect-label"><i /><span>英文释义</span></h4>
                          <p className="study-example-en">{card.english}</p>
                        </div>
                      ) : null}
                      {card.examples.length > 0 ? (
                        <div className="study-sect">
                          <h4 className="study-sect-label"><i /><span>例句</span></h4>
                          <div>
                            {card.examples.map((example) => (
                              <div className="study-example" key={example.en}>
                                <p className="study-example-en">{example.en}</p>
                                {example.cn ? <p className="study-example-cn">{example.cn}</p> : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {card.collocations.length > 0 ? (
                        <div className="study-sect">
                          <h4 className="study-sect-label"><i />常见搭配</h4>
                          <div className="study-collocation-chips">
                            {card.collocations.map((collocation) => (
                              <span key={collocation.text}>
                                {collocation.text}
                                {collocation.cn ? <em>　{collocation.cn}</em> : null}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div className="study-actions">
            <div className="study-quiet-row">
              <button className="study-quiet-button" onClick={() => act((target) => saveCurrent(target))} type="button">
                <kbd>↑</kbd><span>加入生词本</span>
              </button>
            </div>
            <div className="study-grade-row">
              <button className="study-grade-button secondary" onClick={() => act((target) => runSlot(target, "left"))} type="button">
                <kbd>←</kbd><span>{labels.left}</span>
              </button>
              <button className="study-grade-button secondary warn" onClick={() => act((target) => runSlot(target, "down"))} type="button">
                <kbd>↓</kbd><span>{labels.down}</span>
              </button>
              <button className="study-grade-button primary" onClick={() => act((target) => runSlot(target, "right"))} type="button">
                <span>{labels.right}</span><kbd>→</kbd>
              </button>
            </div>
            <div className="study-hint-line">
              <span>双击 <kbd>←</kbd> 返回上一个单词</span>
              <span><kbd>空格</kbd>发音</span>
              <span>双击 <kbd>→</kbd> 不再出现</span>
            </div>
          </div>
        </div>
      </section>
    );
  }

  /* ── 本轮小结 ── */

  if (view === "done" && session) {
    const stats = session.stats;
    const handled = stats.known + stats.unsure + stats.unknown;
    return (
      <section className="study-page" aria-label="本轮小结">
        <div className="study-screen">
          <div className="study-center-stage">
            <div className="study-summary">
              <div className="study-summary-icon"><CheckIcon /></div>
              <h2>这一轮结束了</h2>
              <p className="study-summary-lead">{mode === "new" ? "新学" : "复习"}一组，过手 {handled} 条。</p>
              <div className="study-stat-grid">
                <div className="study-stat known"><b>{stats.known}</b><span>认识</span></div>
                <div className="study-stat unsure"><b>{stats.unsure}</b><span>不确定</span></div>
                <div className="study-stat unknown"><b>{stats.unknown}</b><span>不认识</span></div>
                <div className="study-stat saved"><b>{stats.saved}</b><span>加生词本</span></div>
                <div className="study-stat removed"><b>{stats.removed}</b><span>不再出现</span></div>
              </div>
              <div className="study-next-box">
                <strong>明天要复习 {stats.known + stats.unsure + dueAtStartRef.current} 条</strong>
                ，其中 {stats.unknown ? `${stats.unknown} 条是今天答错的` : "没有今天答错的"}。
                <br />
                今天答对的按档位往后走：认识的多半 1 天后见；答错的这一轮还会再见一次。
                {stats.saved ? <><br />另有 {stats.saved} 条加进了生词本，之后可以从那里复习。</> : null}
                {stats.removed ? <><br />{stats.removed} 条标为不再出现，已经移出这个词库。</> : null}
              </div>
              <div className="study-summary-actions">
                <button className="study-start-button secondary" onClick={() => setView("home")} type="button">返回主页</button>
                <button className="study-start-button" onClick={() => start(mode)} type="button">再来一组</button>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  /* ── 首页 ── */

  const chip = (book: StudySource) => {
    const list = book.group === "vocab" ? vocabWords : books[book.id] ?? [];
    const bookPercent = learnedRatio(list, progress);
    const count = book.group === "vocab" ? `${list.length} 词` : list.length.toLocaleString();
    return (
      <button
        aria-pressed={source.id === book.id}
        className="study-chip"
        data-progress={bookPercent > 0}
        key={book.id}
        onClick={() => { setSourceId(book.id); setNotice(""); }}
        title={`已背 ${bookPercent}%`}
        type="button"
      >
        <span className="study-chip-track" />
        <span className="study-chip-fill" style={{ width: `${bookPercent}%` }} />
        <span className="study-chip-body">{book.name}<small className="study-chip-count">{count}</small></span>
      </button>
    );
  };

  const left = Math.max(0, total - learned);
  const newMinutes = Math.max(1, Math.round((newCount * NEW_SECONDS_PER_WORD) / 60));
  const reviewMinutes = Math.max(1, Math.round((due * REVIEW_SECONDS_PER_WORD) / 60));
  const timeParts = [
    newCount ? `新学约 ${newMinutes} 分钟` : "",
    due ? `复习约 ${reviewMinutes} 分钟` : "",
  ].filter(Boolean);

  return (
    <section className="study-page" aria-label="背单词">
      <div className="study-screen">
        <section className="study-section">
          <div className="study-section-head">
            <h2>学习内容</h2>
            <div className="study-section-meta">
              {isVocab ? (
                <>
                  <strong>{VOCAB_SOURCE.name}</strong>
                  <span>共 {total} 词</span>
                  <span>待学习 {pendingCount(words, progress)}</span>
                  {due ? <span>待复习 {due} 条</span> : null}
                </>
              ) : (
                <>
                  <strong>{sourceName(source)}</strong>
                  <span>已学 {learned.toLocaleString()} / {total.toLocaleString()}</span>
                  <span className="study-mini-bar"><i style={{ width: `${percent}%` }} /></span>
                  <span>还剩 {left.toLocaleString()} 条</span>
                </>
              )}
            </div>
          </div>
          <Row grid label="词库">{WORD_BOOKS.map(chip)}</Row>
          <Row label="词组库">{PHRASE_BOOKS.map(chip)}</Row>
          <div className="study-source-row">
            <div className="study-source-label">生词本</div>
            <div className="study-chips">{chip(VOCAB_SOURCE)}</div>
            <div className="study-source-side">
              <button className="study-chip-link" onClick={() => navigate("/vocabulary")} type="button">管理生词本 →</button>
            </div>
          </div>
        </section>

        {message ? <p className="study-notice">{message}</p> : null}

        <section className="study-section">
          <div className="study-modes">
            <article className="study-mode-card">
              {/* 背新单词的图标按用户要求改成字母 W（Word），不再用预览里那个气泡箭头 */}
              <div className="study-mode-icon new"><span className="study-mode-icon-letter">W</span></div>
              <h3>背新单词</h3>
              <div className="study-mode-num">{newCount}<span>词 · 今日</span></div>
              <p className="study-mode-foot">
                {isVocab ? `生词本里还有 ${pendingCount(words, progress)} 个没开始学` : `${sourceName(source)}还剩 ${left.toLocaleString()} 条`}
              </p>
              <div className="study-mode-strip">
                <span className="study-strip-label">每天背</span>
                <div className="study-seg">
                  {DAILY_CHOICES.map((choice) => (
                    <button aria-pressed={daily === choice} key={choice} onClick={() => setDaily(choice)} type="button">{choice}</button>
                  ))}
                </div>
                <button className="study-start-button" onClick={() => start("new")} type="button">开始</button>
              </div>
            </article>

            <article className="study-mode-card">
              <div className="study-mode-icon review"><ReviewModeIcon /></div>
              <h3>复习单词</h3>
              <div className="study-mode-num">{due}<span>条 · 待复习</span></div>
              <p className="study-mode-foot">
                {due === 0 ? "现在没有到期的，先背新词" : overdue ? `其中 ${overdue} 条是之前积压的` : "都是今天刚到期"}
              </p>
              <div className="study-mode-strip">
                <button className="study-card-link" onClick={() => setDrawerOpen(true)} type="button">查看复习节奏 →</button>
                {due > 0 ? (
                  <button className="study-start-button secondary" onClick={() => start("review")} type="button">开始</button>
                ) : (
                  <span className="study-empty-action">暂无复习任务</span>
                )}
              </div>
            </article>
          </div>
        </section>

        {timeParts.length ? <p className="study-today-line">今天预计用时：{timeParts.join("，")}</p> : null}
      </div>

      {drawerOpen ? (
        <div className="study-drawer-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setDrawerOpen(false); }}>
          <aside aria-label="复习节奏" className="study-drawer" role="dialog">
            <div className="study-drawer-head">
              <div>
                <h2>复习节奏</h2>
                <p>每个词有自己的记忆档位。答对往上升，答错往下退，间隔跟着档位走。</p>
              </div>
              <button aria-label="关掉复习节奏" className="study-icon-button" onClick={() => setDrawerOpen(false)} type="button">
                <CloseIcon />
              </button>
            </div>
            <div className="study-ladder">
              {LADDER_DAYS.map((days, index) => (
                <div className="study-ladder-row" key={days}>
                  <b>L{index + 1}</b>
                  <span>{days} 天后</span>
                  <em>{index === 0 ? "刚学会" : index === LADDER_DAYS.length - 1 ? "已经很稳" : ""}</em>
                </div>
              ))}
            </div>
            <ul className="study-rule-list">
              <li><span className="study-tag known">认识 →</span><span>档位升一级，下次出现的时间往后推。</span></li>
              <li><span className="study-tag unsure">不确定 ↓</span><span>档位不动，但间隔按当前档位的一半算，会提前回来一次。</span></li>
              <li><span className="study-tag unknown">不认识 ←</span><span>退两级，并且这一轮里再过 {RELEARN_GAP} 个词就重考一次。</span></li>
              <li><span className="study-tag saved">加入生词本 ↑</span><span>收进生词本，按不认识处理：退两级、展开释义，并在本轮回炉一次。</span></li>
              <li><span className="study-tag removed">不再出现</span><span>双击 → 才动作：从这个词库永久移出，之后不再进任何队列。</span></li>
            </ul>
            <div className="study-reason">
              隔了几天没学，之前到期的词不会消失：昨天、前天、上个月到期的，都一起算进今天的复习队列，
              所以「待复习」这个数字可能比平时大很多，学完就清了。
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Card } from "@/components/ui/card";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useSearchParams, type NavigateFunction } from "react-router-dom";
import { ArrowLeft, Copy, Eraser, Languages, Palette, Pause, Play, Sparkles, Star, StickyNote, Type, Volume2 } from "@/components/ui/icon";

import { addLearningEvent } from "../learning/learningStore";
import { removeVocabulary, saveVocabulary, useVocabulary, type VocabularyEntry } from "../vocabulary/vocabularyStore";
import { addReadingAnnotation, getReadingRecord, READING_ARTICLE_ID, recordReadingWordQuery, removeReadingAnnotation, saveReadingAnnotations, updateReadingFavorite, updateReadingProgress, type ReadingAnnotation } from "./readingStore";
import { BUNDLED_ARTICLE_DOCUMENT } from "./readingContent";
import { getArticleDocument, needsArticleReextraction } from "./articleRepository";
import { extractArticleDocument, feedItemFromDocument } from "./articleExtraction";
import { isAutoWordLookupEnabled } from "../settings/settingsStore";
import { findWordBounds, getSpeechAccent, getSpeechVoice, type SpeechAccent } from "./speech";
import type { ArticleBlock, ArticleDocument } from "./articleDocument";
import { getQueryResult, loadAiPanels, resolveQuery, resolveTextQuery, isAiPanelId, type QueryPanel, type QueryResult } from "../translation/translationService";
import { OptionalAiPanel } from "../translation/OptionalAiPanel";
import { LookupText } from "../translation/LookupText";
import { fetchWordPronunciation, type WordPronunciation } from "../translation/pronunciationService";
import { formatSourceKicker } from "./sourceLabel";
import { useWordFamilies } from "./wordFamilyStore";
import { buildWordMatcher, findVocabularyEntry } from "./wordMatch";
import { getResumeScrollTop } from "./readingResume";

const SPOKEN_WORD_HIGHLIGHT = "reading-word";

type HighlightRegistry = { set(name: string, highlight: unknown): void; delete(name: string): void };

/** CSS Custom Highlight API: paints the spoken word without touching the React tree. */
function getHighlightApi() {
  const registry = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights;
  const HighlightCtor = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  return registry && HighlightCtor ? { registry, HighlightCtor } : null;
}

function clearSpokenWordHighlight() {
  getHighlightApi()?.registry.delete(SPOKEN_WORD_HIGHLIGHT);
}

function speak(text: string, lang: SpeechAccent = "en-GB", onUnsupported?: () => void, onEnd?: () => void, onBoundary?: (event: SpeechSynthesisEvent) => void) {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") { onUnsupported?.(); return; }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = getSpeechVoice(lang);
  utterance.lang = voice?.lang ?? lang;
  if (voice) utterance.voice = voice;
  utterance.rate = 0.92;
  utterance.onend = onEnd ? () => onEnd() : null;
  utterance.onerror = onEnd ? () => onEnd() : null;
  utterance.onboundary = onBoundary ? (event) => onBoundary(event) : null;
  window.speechSynthesis.speak(utterance);
}

function makeId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }

type HighlightColor = "yellow" | "green" | "pink" | "cyan";

const HIGHLIGHT_COLORS: HighlightColor[] = ["yellow", "green", "pink", "cyan"];
const HIGHLIGHT_COLOR_LABELS: Record<HighlightColor, string> = { yellow: "黄色", green: "绿色", pink: "粉色", cyan: "蓝色" };

/** Joins the notebook into one dependency key; this character can never appear inside a word. */
const WORD_KEY_SEPARATOR = "\u0000";

/** Floating icon toolbar: a horizontal strip anchored near the mouse release point. */
const SELECTION_TOOLBAR_WIDTH = 250;
const SELECTION_TOOLBAR_HEIGHT = 42;
const SELECTION_PALETTE_HEIGHT = 41;
// The translation button is the visual action closest to the selection point.
const SELECTION_TRANSLATE_CENTER_OFFSET = 95;
type SelectionToolbarAnchor = { x: number; y: number; source?: "mouse" | "word" };
type WordAnchor = { left: number; right: number; top: number; bottom: number; width: number };

export function ReadingArticlePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const articleId = searchParams.get("id") ?? READING_ARTICLE_ID;
  const cachedArticle = getArticleDocument(articleId);
  const [reextractedArticle, setReextractedArticle] = useState<ArticleDocument | undefined>(undefined);
  const article = reextractedArticle ?? cachedArticle ?? BUNDLED_ARTICLE_DOCUMENT;
  const scrollRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const wordPopoverRef = useRef<HTMLDivElement>(null);
  const activeWordRef = useRef<HTMLElement | null>(null);
  const [fontSize, setFontSize] = useState(18);
  const [activeTab, setActiveTab] = useState<"vocab" | "notes">("vocab");
  const [currentWord, setCurrentWord] = useState<string | null>(null);
  const [wordAnchor, setWordAnchor] = useState<WordAnchor | null>(null);
  const [wordPopoverPosition, setWordPopoverPosition] = useState({ left: 16, top: 72, placement: "below" as "above" | "below" | "side" });
  const [favorite, setFavorite] = useState(() => getReadingRecord(articleId)?.favorite ?? false);
  const [progress, setProgress] = useState(() => getReadingRecord(articleId)?.progress ?? 0);
  const [annotations, setAnnotations] = useState<ReadingAnnotation[]>(() => getReadingRecord(articleId)?.annotations ?? []);
  const [selection, setSelection] = useState<Range | null>(null);
  const [selectionToolbar, setSelectionToolbar] = useState(false);
  const [selectionHasHighlight, setSelectionHasHighlight] = useState(false);
  const [highlightColor, setHighlightColor] = useState<HighlightColor>("yellow");
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [selectionToolbarPosition, setSelectionToolbarPosition] = useState<{ left: number; top: number; placement: "above" | "below" }>({ left: 16, top: 16, placement: "above" });
  const selectionToolbarAnchorRef = useRef<SelectionToolbarAnchor | null>(null);
  const selectionRangeRef = useRef<Range | null>(null);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [wordPronunciation, setWordPronunciation] = useState<WordPronunciation | null>(null);
  const [queryFromSelection, setQueryFromSelection] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectionContext, setSelectionContext] = useState("");
  const [contextPanels, setContextPanels] = useState<QueryPanel[] | null>(null);
  const [contextStatus, setContextStatus] = useState<"idle" | "loading" | "done">("idle");
  const aiRequestRef = useRef<AbortController | null>(null);
  const speechSegmentsRef = useRef<Array<{ id: string; start: number; end: number }>>([]);
  const spokenOffsetRef = useRef(0);
  const cancellingRef = useRef(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const composerTargetRef = useRef<Pick<ReadingAnnotation, "start" | "end" | "quote"> | null>(null);
  const [composerText, setComposerText] = useState("");
  const [composerSource, setComposerSource] = useState("");
  const [reflection, setReflection] = useState("");
  const [reflectionStatus, setReflectionStatus] = useState("");
  const [reading, setReading] = useState<"idle" | "playing" | "paused">("idle");
  const [notice, setNotice] = useState("");
  const vocabulary = useVocabulary();
  // Inflection has to be resolved before matching, so a saved `run` also lights up `ran`/`running`.
  // `vocabularyKey` is the content of the notebook, which is all the family lookup depends on.
  const vocabularyKey = vocabulary.map((entry) => entry.word.toLowerCase()).sort().join(WORD_KEY_SEPARATOR);
  const wordFamilies = useWordFamilies(vocabularyKey);
  const matchesVocabulary = useMemo(
    () => buildWordMatcher(vocabularyKey ? vocabularyKey.split(WORD_KEY_SEPARATOR) : [], wordFamilies),
    [vocabularyKey, wordFamilies],
  );
  const vocabEntry = currentWord ? findVocabularyEntry(vocabulary, currentWord, wordFamilies) : undefined;
  const added = !!vocabEntry;
  const britishPhonetic = wordPronunciation?.british.ipa || vocabEntry?.britishPhonetic || vocabEntry?.phonetic || "";
  const americanPhonetic = wordPronunciation?.american.ipa || "";
  const articleSections = getArticleSections(article);
  const articleWords = useMemo(() => new Set((getArticleBodyText(article).toLowerCase().match(/[a-z]+(?:[-'][a-z]+)*/g) ?? [])), [article]);
  const articleVocabulary = vocabulary.filter((entry) => articleWords.has(entry.word.toLowerCase()));
  const annotationText = getArticleBodyText(article);
  const normalizedAnnotations = normalizeAnnotations(annotations, annotationText);
  const blockStarts = new Map<string, number>();
  {
    let offset = article.title.length + article.summary.length + getArticleMetaText(article).length;
    for (const block of article.blocks) { blockStarts.set(block.id, offset); offset += getBlockText(block).length; }
  }
  const textRenderContext: TextRenderContext = { matchesVocabulary, onWord: selectWord };
  const outlineSlot = typeof document === "undefined" ? null : document.getElementById("reading-outline-sidebar-slot");
  const outlineNavigation = articleSections.length > 0 && (
    <div className="reading-outline-nav">
      <div className="reading-outline-title">文章目录</div>
      {articleSections.map((section) => (
        <button
          className="reading-outline-item"
          key={section.id}
          onClick={() => document.getElementById(section.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
          type="button"
        >
          {section.label}
        </button>
      ))}
    </div>
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const element = scrollRef.current;
      const max = element ? element.scrollHeight - element.clientHeight : 0;
      if (element && max > 0) {
        const behavior = element.style.scrollBehavior;
        element.style.scrollBehavior = "auto";
        element.scrollTop = getResumeScrollTop(location.state) ?? max * Math.min(100, Math.max(0, progress)) / 100;
        element.style.scrollBehavior = behavior;
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  useEffect(() => () => aiRequestRef.current?.abort(), []);

  useEffect(() => clearSpokenWordHighlight, []);

  useEffect(() => {
    if (!cachedArticle || !needsArticleReextraction(cachedArticle)) return;
    let cancelled = false;
    void extractArticleDocument(feedItemFromDocument(cachedArticle))
      .then((fresh) => { if (!cancelled) setReextractedArticle(fresh); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [articleId]);

  useEffect(() => {
    if (!currentWord) {
      setWordPronunciation(null);
      return;
    }
    const controller = new AbortController();
    void fetchWordPronunciation(currentWord, controller.signal, (pronunciation) => {
      if (!controller.signal.aborted) setWordPronunciation(pronunciation);
    }).then((pronunciation) => {
      if (controller.signal.aborted) return;
      setWordPronunciation(pronunciation);
    });
    return () => controller.abort();
  }, [currentWord]);

  useLayoutEffect(() => {
    const card = wordPopoverRef.current;
    if (!wordAnchor || !card) return;
    const margin = 12;
    const gap = 10;
    const rect = card.getBoundingClientRect();
    const toolbarBottom = document.querySelector<HTMLElement>(".reading-toolbar")?.getBoundingClientRect().bottom ?? margin;
    const minTop = toolbarBottom + margin;
    const centredLeft = wordAnchor.left + wordAnchor.width / 2 - rect.width / 2;
    const left = Math.min(window.innerWidth - rect.width - margin, Math.max(margin, centredLeft));
    const spaceBelow = window.innerHeight - wordAnchor.bottom - gap - margin;
    const spaceAbove = wordAnchor.top - gap - minTop;
    if (spaceBelow >= Math.min(rect.height, 260) || spaceBelow >= spaceAbove) {
      setWordPopoverPosition({ left, top: Math.min(window.innerHeight - rect.height - margin, wordAnchor.bottom + gap), placement: "below" });
    } else {
      setWordPopoverPosition({ left, top: Math.max(minTop, wordAnchor.top - rect.height - gap), placement: "above" });
    }
  }, [wordAnchor, queryResult, wordPronunciation]);

  useEffect(() => {
    if (!wordAnchor) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (wordPopoverRef.current?.contains(target) || (target instanceof Element && target.closest(".reading-lookup-word"))) return;
      setWordAnchor(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setWordAnchor(null); };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [wordAnchor]);

  useEffect(() => {
    if (wordAnchor) return;
    activeWordRef.current?.classList.remove("is-active");
    activeWordRef.current = null;
  }, [wordAnchor]);

  useEffect(() => {
    if (!selectionToolbar) return;
    const update = () => {
      if (selection) setSelectionToolbarPosition(getSelectionToolbarPosition(selection, selectionToolbarAnchorRef.current ?? undefined));
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    scrollRef.current?.addEventListener("scroll", update);
    update();
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      scrollRef.current?.removeEventListener("scroll", update);
    };
  }, [selectionToolbar, selection]);

  useEffect(() => {
    const handleSelectionChange = () => {
      const browserSelection = window.getSelection();
      const range = browserSelection && browserSelection.rangeCount > 0 ? browserSelection.getRangeAt(0) : null;
      if (!range || range.collapsed || !bodyRef.current?.contains(range.commonAncestorContainer)) {
        selectionToolbarAnchorRef.current = null;
        selectionRangeRef.current = null;
        setSelection(null);
        setSelectionHasHighlight(false);
        setSelectionToolbar(false);
        setColorPickerOpen(false);
        return;
      }
      const capturedRange = selectionRangeRef.current;
      if (!capturedRange || !rangesMatch(capturedRange, range)) selectionToolbarAnchorRef.current = null;
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

  function toast(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => current === message ? "" : current), 1800);
  }

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;
    const max = element.scrollHeight - element.clientHeight;
    const next = max <= 0 ? 100 : Math.min(100, Math.max(0, Math.round((element.scrollTop / max) * 100)));
    setProgress(next);
    const previous = getReadingRecord(articleId);
    saveReadingProgress(next);
    if ((!previous || previous.progress === 0) && next > 0) addLearningEvent({ type: "reading", label: article.title });
    setWordAnchor(null);
  }

  function saveReadingProgress(next: number) {
    updateReadingProgress(articleId, next, article.title);
  }

  function selectWord(word: string, anchor: WordAnchor, target: HTMLElement) {
    aiRequestRef.current?.abort();
    const controller = new AbortController();
    aiRequestRef.current = controller;
    setContextPanels(null);
    setContextStatus("idle");
    setSelectionContext("");
    setCurrentWord(word.toLowerCase());
    setWordAnchor(anchor);
    activeWordRef.current?.classList.remove("is-active");
    target.classList.add("is-active");
    activeWordRef.current = target;
    setQueryFromSelection(false);
    const base = getQueryResult(word, { ai: false });
    setQueryResult(base);
    recordReadingWordQuery(articleId, word, article.title);
    speak(word, getSpeechAccent());
    void resolveQuery(word, controller.signal, { ai: false })
      .then((loaded) => { if (!controller.signal.aborted) setQueryResult(loaded); })
      .catch(() => { if (!controller.signal.aborted) setQueryResult(base); });
  }

  /** A saved-vocabulary word is a button, so double-clicking it opens the same right-hand panel. */
  function lookupMarkedWord(_word: string, range: Range) {
    void translateSelection(range);
  }

  async function translateSelection(target: Range | null = selection, options: { keepSelection?: boolean; text?: string } = {}) {
    const text = options.text ?? target?.toString().trim() ?? "";
    if (!text) return;
    setPanelOpen(true);
    const base = getQueryResult(text);
    setQueryResult(base);
    setQueryFromSelection(true);
    setActiveTab("vocab");
    setContextPanels(null);
    setContextStatus("idle");
    aiRequestRef.current?.abort();
    const controller = new AbortController();
    aiRequestRef.current = controller;
    if (base.kind === "word") {
      const word = base.query.toLowerCase();
      setCurrentWord(word);
      const context = target ? getSelectionSentence(target) : "";
      setSelectionContext(context);
      recordReadingWordQuery(articleId, word, article.title);
      void resolveQuery(word, controller.signal, { ai: false })
        .then((loaded) => { if (!controller.signal.aborted) setQueryResult(loaded); })
        .catch(() => { if (!controller.signal.aborted) setQueryResult(base); });
    } else {
      setCurrentWord(null);
      setSelectionContext("");
      // The free local translation is shown before the optional news-register AI card.
      setQueryResult(base);
      void resolveTextQuery(text, { register: "news" }, controller.signal)
        .then((translated) => { if (!controller.signal.aborted) setQueryResult(translated); })
        .catch(() => { if (!controller.signal.aborted) setQueryResult(base); });
    }
    if (!options.keepSelection) finishSelection();
  }

  /** Manual contextual lookup remains available when automatic AI is off. */
  function requestContextMeaning() {
    if (!currentWord || !selectionContext) return;
    const controller = aiRequestRef.current ?? new AbortController();
    aiRequestRef.current = controller;
    setContextStatus("loading");
    void loadAiPanels(currentWord, {
      mode: "word",
      context: selectionContext,
      label: "AI 语境义",
      badge: "结合本句",
      title: "在本文中的意思",
    }, controller.signal).then((panels) => {
      if (controller.signal.aborted) return;
      setContextPanels(panels);
      setContextStatus("done");
    });
  }

  function toggleSavedWord() {
    if (!currentWord) return;
    if (added) {
      // The panel may be showing an inflected form of a saved word, so remove the saved entry.
      const savedWord = vocabEntry?.word ?? currentWord;
      removeVocabulary(savedWord);
        toast(`已从生词本移除 ${savedWord}`);
      return;
    }
    const dictionaryEntry = queryResult?.kind === "word" ? queryResult.entries[0] : undefined;
    saveVocabulary({
      word: currentWord,
      phonetic: britishPhonetic || "",
      britishPhonetic,
      americanPhonetic,
      meaning: dictionaryEntry ? dictionaryEntry.meanings.map((group) => group.translations.join("；")).join("\n") : queryResult?.kind === "word" ? queryResult.meaning : "",
      definition: dictionaryEntry?.definition,
      partOfSpeech: dictionaryEntry?.partOfSpeech,
      collocations: dictionaryEntry?.collocations,
      collocationTranslations: dictionaryEntry?.collocationTranslations,
      examples: dictionaryEntry?.examples,
      example: dictionaryEntry?.example ?? (queryResult?.kind === "word" ? queryResult.example : ""),
      source: queryResult?.kind === "word" ? queryResult.source : "本地词库",
      sourceType: "reading",
    });
    toast(`已加入生词本 ${currentWord}`);
  }

  function cycleFontSize() { setFontSize((current) => current === 20 ? 17 : current + 1); toast("已调整正文字号"); }

  function speakCurrentWord(lang: "en-GB" | "en-US") {
    if (!currentWord) return;
    const accent = lang === "en-GB" ? wordPronunciation?.british : wordPronunciation?.american;
    if (accent?.audioUrl && typeof Audio !== "undefined") {
      const audio = new Audio(accent.audioUrl);
      void audio.play().catch(() => speak(currentWord, lang, () => toast("当前浏览器不支持系统朗读")));
      return;
    }
    speak(currentWord, lang, () => toast("当前浏览器不支持系统朗读"));
  }

  /** The title, the summary and every block carry an id so the reader can highlight them all. */
  const READING_SEGMENT_SELECTOR = "h1, h2, h3, p, blockquote, ol, ul, .reading-dek";

  function clearReadingHighlights() {
    clearSpokenWordHighlight();
    bodyRef.current?.querySelectorAll(".reading-current-paragraph").forEach((node) => node.classList.remove("reading-current-paragraph"));
  }

  function paintSpeechProgress(absoluteIndex: number, charLength: number, name?: string) {
    const root = bodyRef.current;
    if (!root) return;
    const segment = speechSegmentsRef.current.find((item) => absoluteIndex >= item.start && absoluteIndex < item.end)
      ?? speechSegmentsRef.current.find((item) => item.end >= absoluteIndex);
    const targetId = segment?.id ?? null;
    root.querySelectorAll<HTMLElement>(READING_SEGMENT_SELECTOR).forEach((node) => {
      node.classList.toggle("reading-current-paragraph", targetId !== null && node.id === targetId);
    });
    if (name && name !== "word") return;
    const api = getHighlightApi();
    const element = targetId ? root.querySelector<HTMLElement>(`[id="${targetId}"]`) : null;
    if (!api || !element || !segment) return;
    // charLength from the engine can span more than one word, so the highlight is always one word.
    void charLength;
    const bounds = findWordBounds(element.textContent ?? "", absoluteIndex - segment.start);
    const range = bounds ? rangeFromOffsets(element, bounds.start, bounds.end) : null;
    if (range) api.registry.set(SPOKEN_WORD_HIGHLIGHT, new api.HighlightCtor(range));
  }

  /** Starts (or resumes) from a character offset so pause / continue never restarts the article. */
  function startReading(fromOffset = 0) {
    if (!("speechSynthesis" in window)) { toast("当前浏览器不支持系统朗读"); return; }
    const speech = getArticleSpeech(article);
    speechSegmentsRef.current = speech.segments.map((segment) => ({ id: segment.id ?? "", start: segment.start, end: segment.end }));
    const start = Math.max(0, Math.min(fromOffset, Math.max(0, speech.text.length - 1)));
    spokenOffsetRef.current = start;
    const text = start > 0 ? speech.text.slice(start) : speech.text;
    speak(text, getSpeechAccent(), () => toast("当前浏览器不支持系统朗读"), () => {
      if (cancellingRef.current) { cancellingRef.current = false; return; }
      // Reaching the end resets the bookmark so the next click reads from the beginning again.
      spokenOffsetRef.current = 0;
      setReading("idle");
      clearReadingHighlights();
    }, (event) => {
      const absolute = start + event.charIndex;
      spokenOffsetRef.current = absolute;
      paintSpeechProgress(absolute, (event as SpeechSynthesisEvent & { charLength?: number }).charLength ?? 0, event.name);
    });
    setReading("playing");
  }

  function pauseReading() {
    cancellingRef.current = true;
    window.speechSynthesis.cancel();
    setReading("paused");
  }

  function toggleReading() {
    if (reading === "playing") { pauseReading(); return; }
    startReading(spokenOffsetRef.current);
  }

  /** The selection toolbar reads from the selected spot down to the end of the article. */
  function readFromSelection() {
    if (!selection) { toggleReading(); return; }
    const located = locateSpeechSegment(selection.startContainer);
    if (!located) { startReading(spokenOffsetRef.current); return; }
    startReading(located.segment.start + getRangeOffsets(located.element, selection).start);
  }

  /** Climbs from a node to the nearest element that the spoken text knows about. */
  function locateSpeechSegment(node: Node) {
    let current: HTMLElement | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
    while (current) {
      const segment = speechSegmentsRef.current.find((item) => item.id && item.id === current?.id);
      if (segment) return { element: current, segment };
      current = current.parentElement;
    }
    return null;
  }

  function captureSelection(event: ReactMouseEvent<HTMLDivElement>) {
    const browserSelection = window.getSelection();
    if (!browserSelection || browserSelection.rangeCount === 0 || !bodyRef.current) return;
    const range = browserSelection.getRangeAt(0);
    if (!bodyRef.current.contains(range.commonAncestorContainer) || !range.toString().trim()) return;
    const expanded = expandRangeToWordBoundaries(bodyRef.current, range);
    if (!expanded || !expanded.toString().trim()) return;
    browserSelection.removeAllRanges();
    browserSelection.addRange(expanded);
    const capturedRange = expanded.cloneRange();
    const selected = expanded.toString();
    const word = selected.replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/g, "");
    const rangeRect = (expanded as Range & { getBoundingClientRect?: () => DOMRect }).getBoundingClientRect?.();
    const hasMousePoint = Number.isFinite(event.clientX) && Number.isFinite(event.clientY);
    selectionRangeRef.current = capturedRange;
    selectionToolbarAnchorRef.current = hasMousePoint
      ? isSingleWord(word) && rangeRect && rangeRect.width > 0 && rangeRect.height > 0
        ? { x: (rangeRect.left + rangeRect.right) / 2, y: rangeRect.bottom, source: "word" }
        : { x: event.clientX, y: event.clientY, source: "mouse" }
      : null;
    setSelection(capturedRange);
    setSelectionHasHighlight(hasSelectionHighlight(annotations, getRangeOffsets(bodyRef.current, expanded)));
    setSelectionToolbarPosition(getSelectionToolbarPosition(expanded, selectionToolbarAnchorRef.current ?? undefined));
    setSelectionToolbar(true);
    // A double-clicked word is looked up immediately; phrases and paragraphs stay manual.
    // The selection and its toolbar stay on screen so the other actions remain reachable.
    if (isAutoWordLookupEnabled() && isSingleWord(word)) void translateSelection(expanded, { keepSelection: true, text: word });
  }

  function addHighlight(color: ReadingAnnotation["color"]) {
    if (!selection || !bodyRef.current) return;
    const offsets = getRangeOffsets(bodyRef.current, selection);
    const item: ReadingAnnotation = { id: makeId(), start: offsets.start, end: offsets.end, quote: selection.toString(), kind: "highlight", color: color ?? "yellow", createdAt: Date.now() };
    const next = [...annotations, item];
    setAnnotations(next);
    saveReadingAnnotations(articleId, next, article.title);
    finishSelection();
    toast("已添加高亮");
  }

  function openComposer() {
    if (!selection || !bodyRef.current) return;
    setPanelOpen(true);
    // Editing the note moves browser focus away from the selected article text.
    composerTargetRef.current = { ...getRangeOffsets(bodyRef.current, selection), quote: selection.toString() };
    setComposerSource(selection.toString());
    setComposerText("");
    setComposerOpen(true);
    setActiveTab("notes");
    setSelectionToolbar(false);
  }

  function cancelHighlight() {
    if (!selection || !bodyRef.current) return;
    const offsets = getRangeOffsets(bodyRef.current, selection);
    const removed = annotations.filter((item) => item.kind === "highlight" && item.start < offsets.end && item.end > offsets.start);
    if (!removed.length) { toast("所选内容没有可取消的高亮"); return; }
    const ids = new Set(removed.map((item) => item.id));
    const next = annotations.filter((item) => !ids.has(item.id));
    setAnnotations(next);
    saveReadingAnnotations(articleId, next, article.title);
    finishSelection();
    toast("已取消高亮");
  }

  function saveNote() {
    const target = composerTargetRef.current;
    if (!target || !composerText.trim()) return;
    const item: ReadingAnnotation = { id: makeId(), ...target, kind: "note", note: composerText.trim(), createdAt: Date.now() };
    const next = [...annotations, item];
    setAnnotations(next);
    addReadingAnnotation(articleId, item, article.title);
    setComposerOpen(false);
    composerTargetRef.current = null;
    setComposerText("");
    finishSelection();
    toast("批注已保存到右侧");
  }

  function copySelection() {
    const text = selection?.toString() ?? "";
    navigator.clipboard?.writeText(text).then(() => toast("已复制")).catch(() => toast("浏览器未授予剪贴板权限"));
    finishSelection();
  }

  function finishSelection() { window.getSelection()?.removeAllRanges(); selectionToolbarAnchorRef.current = null; selectionRangeRef.current = null; setSelection(null); setSelectionHasHighlight(false); setSelectionToolbar(false); setColorPickerOpen(false); }

  function removeAnnotation(annotation: ReadingAnnotation) {
    removeReadingAnnotation(articleId, annotation.id);
    setAnnotations((current) => current.filter((item) => item.id !== annotation.id));
    toast("已移除批注");
  }

  return <section className="reading-article-page" aria-label="阅读文章">
    {outlineSlot && outlineNavigation && createPortal(outlineNavigation, outlineSlot)}
    <section className="reading-reader-shell">
      <div aria-label="阅读工具" className="reading-toolbar" role="toolbar">
        <div className="reading-toolbar-layout">
          <div className="reading-toolbar-article-slot">
            <div className="reading-tool-cluster" data-testid="reading-tool-cluster">
              <Button size="sm" variant="ghost" aria-label="返回阅读列表" onClick={() => navigateFromArticle(navigate, location.state)} type="button"><ArrowLeft size={16} />返回</Button>
              <Button size="sm" variant="ghost" aria-label="切换字号" onClick={cycleFontSize} type="button"><Type size={15} />字体</Button>
              <Button size="sm" variant="ghost" aria-label={reading === "playing" ? "暂停朗读" : reading === "paused" ? "继续朗读" : "听读"} aria-pressed={reading !== "idle"} className={reading === "idle" ? "" : "active"} onClick={toggleReading} title="听读全文" type="button">{reading === "playing" ? <Pause size={15} /> : reading === "paused" ? <Play size={15} /> : <Volume2 size={15} />}朗读</Button>
              <Button size="sm" variant="ghost" aria-label={favorite ? "取消收藏" : "收藏文章"} aria-pressed={favorite} className={favorite ? "active" : ""} onClick={() => { const next = !favorite; setFavorite(next); updateReadingFavorite(articleId, next, article.title); toast(next ? "已收藏这篇文章" : "已取消收藏"); }} type="button"><Star size={15} />收藏</Button>
              <div className="reading-toolbar-progress" title="阅读进度"><div className="reading-progress-mini"><i style={{ width: `${progress}%` }} /></div><span>{progress}%</span></div>
            </div>
          </div>
          <div aria-hidden="true" className="reading-toolbar-vocab-slot" />
        </div>
      </div>
      <div className="reading-workspace">
        <main className="reading-article-scroll" data-testid="article-scroll" onScroll={handleScroll} ref={scrollRef}><article className="reading-article-wrap"><div className="reading-article-kicker"><span className="reading-source-dot" /> {formatSourceKicker(article.source, article.category)}</div>
          <div className="reading-article-body" data-testid="article-body" ref={bodyRef} style={{ fontSize: `${fontSize}px` }}><h1 className="reading-article-title" id="reading-title">{renderTextWithLookups(article.title, textRenderContext)}</h1><div className="reading-dek" id="reading-summary">{renderTextWithLookups(article.summary, textRenderContext)}</div><div className="reading-meta-row">{getArticleMetaParts(article).map((part, index) => <Fragment key={`${part.text}-${index}`}>{index > 0 && <span>·</span>}<span>{part.text}</span></Fragment>)}</div>
            {article.blocks.map((block) => renderArticleBlock(block, blockStarts.get(block.id) ?? 0, textRenderContext))}
          </div>
          <section className="reading-reflection" aria-label="读后记录"><h3>读完了，留下点什么。</h3><div className="reading-reflection-box"><textarea aria-label="读后感" className="reading-reflection-textarea" maxLength={280} onChange={(event) => { setReflection(event.target.value); setReflectionStatus(""); }} placeholder="写下你对这篇文章的想法……" value={reflection} /><div className="reading-reflection-actions"><span>{reflection.length} / 280</span><span className="reading-reflection-status">{reflectionStatus}</span><Button size="sm" variant="primary" onClick={() => { if (!reflection.trim()) { toast("先写一点内容"); return; } setReflectionStatus("已保存 · 刚刚"); toast("已保存"); }} type="button">保存</Button></div></div></section>
        </article></main>
        <aside className="reading-side-drawer is-open">
          <Card role="complementary" aria-label="生词本" className="reading-right-panel reading-vocabulary-sidebar" data-testid="reader-side-panel" id="readerSidePanel"><ReadingVocabularySidebar entries={articleVocabulary} onOpen={() => navigate("/vocabulary")} onRemove={(word) => { removeVocabulary(word); toast(`已从生词本移除 ${word}`); }} /></Card>
        </aside>
      </div>
    </section>
    {currentWord && wordAnchor && <div className={`reading-word-popover is-${wordPopoverPosition.placement}`} data-testid="reading-word-popover" ref={wordPopoverRef} style={{ left: wordPopoverPosition.left, top: wordPopoverPosition.top }}>
      <WordLookupCard word={currentWord} vocabEntry={vocabEntry} queryResult={queryResult} britishPhonetic={britishPhonetic} americanPhonetic={americanPhonetic} added={added} onClose={() => setWordAnchor(null)} onToggleVocabulary={toggleSavedWord} onSpeak={speakCurrentWord} onLookup={word => navigate(`/query?q=${encodeURIComponent(word)}`)} />
    </div>}
    <div aria-live="polite" className={`reading-toast ${notice ? "show" : ""}`}>{notice}</div>
  </section>;
}

function LookupWord({ word, saved, onClick }: { word: string; saved: boolean; onClick: (word: string, anchor: WordAnchor, target: HTMLElement) => void }) {
  const open = (target: HTMLElement) => {
    if (window.getSelection()?.toString().trim()) return;
    const rect = target.getBoundingClientRect();
    onClick(word, { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width }, target);
  };
  return <span
    aria-label={`查词 ${word}`}
    className={`reading-lookup-word ${saved ? "is-saved" : ""}`}
    onClick={(event) => open(event.currentTarget)}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(event.currentTarget); } }}
    role="button"
    tabIndex={0}
  >{word}</span>;
}

function getArticleSections(article: ArticleDocument) {
  const sections: Array<{ id: string; label: string }> = [];
  const firstParagraph = article.blocks.find((block) => block.type === "paragraph");
  if (firstParagraph) sections.push({ id: firstParagraph.id, label: "Introduction" });
  article.blocks.filter((block): block is Extract<ArticleBlock, { type: "heading" }> => block.type === "heading").forEach((block) => {
    const label = block.text === "A changing economic case" ? "Economy" : block.text === "Climate pressure is increasing" ? "Climate" : block.text === "What happens next" ? "Outlook" : block.text;
    sections.push({ id: block.id, label });
  });
  return sections.length > 1 ? sections : [];
}

function getArticleSpeech(article: ArticleDocument) {
  const parts: Array<{ id: string | null; text: string }> = [
    { id: "reading-title", text: article.title },
    { id: "reading-summary", text: article.summary },
  ];
  article.blocks.forEach((block) => {
    if (block.type === "paragraph" || block.type === "heading") parts.push({ id: block.id, text: block.text });
    if (block.type === "quote") {
      parts.push({ id: block.id, text: block.text });
      if (block.attribution) parts.push({ id: null, text: block.attribution });
    }
    if (block.type === "list") block.items.forEach((item) => parts.push({ id: block.id, text: item }));
    if (block.type === "image" && block.caption) parts.push({ id: null, text: block.caption });
  });
  const usable = parts.filter((part) => part.text.trim().length > 0);
  let position = 0;
  const segments = usable.map((part, index) => {
    const segment = { id: part.id, start: position, end: position + part.text.length };
    position = segment.end + (index < usable.length - 1 ? 2 : 0);
    return segment;
  });
  return { text: usable.map((part) => part.text).join("\n\n"), segments };
}

type TextRenderContext = {
  matchesVocabulary: (word: string) => boolean;
  onWord: (word: string, anchor: WordAnchor, target: HTMLElement) => void;
};

function renderArticleBlock(block: ArticleBlock, blockStart: number, context: TextRenderContext): ReactNode {
  if (block.type === "paragraph") return <p id={block.id} key={block.id}>{renderUnit(block.text, blockStart, context)}</p>;
  if (block.type === "heading") return block.level === 3 ? <h3 id={block.id} key={block.id}>{block.text}</h3> : <h2 id={block.id} key={block.id}>{block.text}</h2>;
  if (block.type === "image") return <figure className="reading-article-figure" id={block.id} key={block.id}><img alt={block.alt} src={block.src} /><figcaption>{block.caption}</figcaption></figure>;
  if (block.type === "quote") return <blockquote id={block.id} key={block.id}><p>{renderUnit(block.text, blockStart, context)}</p>{block.attribution && <cite>{block.attribution}</cite>}</blockquote>;
  let itemStart = blockStart;
  const items = block.items.map((item) => { const start = itemStart; itemStart += item.length; return start; });
  return block.ordered
    ? <ol id={block.id} key={block.id}>{block.items.map((item, index) => <li key={item}>{renderUnit(item, items[index], context)}</li>)}</ol>
    : <ul id={block.id} key={block.id}>{block.items.map((item, index) => <li key={item}>{renderUnit(item, items[index], context)}</li>)}</ul>;
}

function renderUnit(text: string, absStart: number, context: TextRenderContext): ReactNode[] {
  void absStart;
  return renderTextWithLookups(text, context);
}

function renderTextWithLookups(text: string, context: TextRenderContext): ReactNode[] {
  const parts = text.split(/(\b[a-zA-Z]+(?:[-'][a-zA-Z]+)*\b)/);
  return parts.map((part, index) => {
    if (!part) return part;
    if (!/^[a-zA-Z]+(?:[-'][a-zA-Z]+)*$/.test(part)) return part;
    return <LookupWord key={`${part}-${index}`} word={part} saved={context.matchesVocabulary(part)} onClick={context.onWord} />;
  });
}

type ArticleMetaPart = { text: string; chip?: boolean };

/**
 * Meta line under the article summary. The kicker already names the source, so BBC
 * articles show only the date and the reading time here instead of repeating
 * "BBC News" plus a "BBC" chip a second time.
 */
function getArticleMetaParts(article: ArticleDocument): ArticleMetaPart[] {
  const parts: ArticleMetaPart[] = [];
  if (article.source === "bundled") parts.push({ text: "Daniel Carter" });
  if (article.author) parts.push({ text: `By ${article.author}` });
  parts.push({ text: formatArticleDate(article.publishedAt) });
  if (article.source === "bundled") parts.push({ text: "B2", chip: true });
  parts.push({ text: `${estimateReadingMinutes(article)} min read`, chip: true });
  return parts;
}

function navigateFromArticle(navigate: NavigateFunction, state: unknown) {
  const returnTo = state && typeof state === "object" && "returnTo" in state
    ? (state as { returnTo?: { pathname?: string; search?: string } }).returnTo
    : undefined;
  if (returnTo?.pathname) {
    navigate({ pathname: returnTo.pathname, search: returnTo.search ?? "" });
    return;
  }
  navigate("/reading");
}

function getArticleMetaText(article: ArticleDocument) {
  return getArticleMetaParts(article).map((part) => part.text).join("·");
}

function getBlockText(block: ArticleBlock): string {
  if (block.type === "paragraph" || block.type === "heading") return block.text;
  if (block.type === "quote") return block.text + (block.attribution ?? "");
  if (block.type === "image") return block.caption ?? "";
  return block.items.join("");
}

function getArticleBodyText(article: ArticleDocument) {
  return article.title + article.summary + getArticleMetaText(article) + article.blocks.map(getBlockText).join("");
}

function normalizeAnnotations(annotations: ReadingAnnotation[], bodyText: string): ReadingAnnotation[] {
  return annotations.flatMap((annotation) => {
    if (bodyText.slice(annotation.start, annotation.end) === annotation.quote) return [annotation];
    const index = bodyText.indexOf(annotation.quote);
    if (index < 0) return [];
    return [{ ...annotation, start: index, end: index + annotation.quote.length }];
  });
}

function formatArticleDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function estimateReadingMinutes(article: ArticleDocument) {
  const characters = article.blocks.map((block) => block.type === "list" ? block.items.join(" ") : "text" in block ? block.text : block.alt).join(" ").length;
  return Math.max(1, Math.round(characters / 900));
}

function ReadingVocabularySidebar({ entries, onOpen, onRemove }: { entries: VocabularyEntry[]; onOpen: () => void; onRemove: (word: string) => void }) {
  return <div className="reading-vocab-sidebar-content">
    <header className="reading-vocab-sidebar-header"><div><span>本篇</span><h2>生词本</h2></div><strong>{entries.length}</strong></header>
    <div className="reading-vocab-sidebar-list">
      {entries.length === 0 && <div className="reading-vocab-empty"><Star aria-hidden="true" size={22} /><p>点击正文中的单词，再加入生词本。</p></div>}
      {entries.map((entry) => <article className="reading-vocab-item" key={entry.id}>
        <div><strong>{entry.word}</strong>{entry.britishPhonetic && <span>/{entry.britishPhonetic.replaceAll("/", "")}/</span>}</div>
        <p>{entry.meaning.split("\n").filter(Boolean).join("；") || "暂无释义"}</p>
        <button aria-label={`从生词本移除 ${entry.word}`} onClick={() => onRemove(entry.word)} title="移除" type="button">×</button>
      </article>)}
    </div>
    <Button size="sm" variant="secondary" className="reading-vocab-open" onClick={onOpen} type="button">打开完整生词本</Button>
  </div>;
}

function WordLookupCard({ word, vocabEntry, queryResult, britishPhonetic, americanPhonetic, added, onClose, onToggleVocabulary, onSpeak, onLookup }: { word: string; vocabEntry?: VocabularyEntry; queryResult: QueryResult | null; britishPhonetic: string; americanPhonetic: string; added: boolean; onClose: () => void; onToggleVocabulary: () => void; onSpeak: (lang: "en-GB" | "en-US") => void; onLookup: (word: string) => void }) {
  const [aiStatus, setAiStatus] = useState<"idle" | "loading" | "done">("idle");
  const [aiPanels, setAiPanels] = useState<QueryPanel[]>([]);
  const aiExplanationRequest = useRef<AbortController | null>(null);
  const entry = queryResult?.kind === "word" ? queryResult.entries[0] : undefined;
  const meanings = entry?.meanings ?? [];
  const examples = entry?.examples?.length ? entry.examples : vocabEntry?.examples ?? [];
  const collocations = entry?.collocations?.length ? entry.collocations : vocabEntry?.collocations ?? [];
  const collocationTranslations = entry?.collocationTranslations ?? vocabEntry?.collocationTranslations ?? {};
  const loading = queryResult?.kind === "word" && queryResult.status === "loading";
  useEffect(() => {
    setAiStatus("idle");
    setAiPanels([]);
    return () => aiExplanationRequest.current?.abort();
  }, [word]);
  const requestAiExplanation = () => {
    if (aiStatus !== "idle") return;
    const controller = new AbortController();
    aiExplanationRequest.current = controller;
    setAiStatus("loading");
    void loadAiPanels(word, { mode: "word", label: "AI 解释", badge: "", title: "AI 解释" }, controller.signal)
      .then((panels) => { if (!controller.signal.aborted) { setAiPanels(panels); setAiStatus("done"); } });
  };
  return <div className="reading-word-card">
    <header><div><strong>{word}</strong><span>{entry?.partOfSpeech || vocabEntry?.partOfSpeech || ""}</span></div><button aria-label="关闭查词卡片" onClick={onClose} type="button">×</button></header>
    <div className="reading-word-phonetics"><Button size="sm" variant="secondary" onClick={() => onSpeak("en-GB")} type="button"><Volume2 aria-hidden="true" size={13} />英 {britishPhonetic || "—"}</Button><Button size="sm" variant="secondary" onClick={() => onSpeak("en-US")} type="button"><Volume2 aria-hidden="true" size={13} />美 {americanPhonetic || "—"}</Button></div>
    <div className="reading-word-meanings">
      {meanings.length > 0 ? meanings.map((meaning) => <p key={`${meaning.partOfSpeech}-${meaning.translations.join("-")}`}><em>{meaning.partOfSpeech}</em>{meaning.translations.join("；")}</p>)
        : vocabEntry?.meaning ? <p>{vocabEntry.meaning.split("\n").filter(Boolean).join("；")}</p>
          : <p>{loading ? "正在查询本地词典…" : "本地词典暂时没有收录这个词。"}</p>}
    </div>
    {examples.length > 0 && <details><summary>常见例句 <span>{examples.length}</span></summary>{examples.slice(0, 4).map((example, index) => <div className="reading-word-example" key={`${example.text}-${index}`}><p>{example.text}</p>{example.translation && <span>{example.translation}</span>}</div>)}</details>}
    {collocations.length > 0 && <details><summary>常见搭配 <span>{collocations.length}</span></summary><div className="reading-word-collocations">{collocations.slice(0, 10).map((item) => <p key={item}><strong>{item}</strong>{collocationTranslations[item] && <span>{collocationTranslations[item]}</span>}</p>)}</div></details>}
    <details onToggle={(event) => { if (event.currentTarget.open) requestAiExplanation(); }}><summary>AI 解释</summary><div className="reading-word-ai">{aiStatus === "loading" && <p>正在调用 AI 解释…</p>}{aiPanels.map((panel) => <section key={panel.id}>{panel.title && panel.title !== "AI 解释" && <strong><LookupText text={panel.title} onLookup={panel.id === "ai-error" ? undefined : onLookup} /></strong>}<p><LookupText text={panel.body} onLookup={panel.id === "ai-error" ? undefined : onLookup} /></p></section>)}</div></details>
    {entry?.wordForms?.length ? <details><summary>词形变化 <span>{entry.wordForms.length}</span></summary><div className="reading-word-forms">{entry.wordForms.map((form) => <p key={`${form.label}-${form.value}`}><span>{form.label}</span><strong>{form.value}</strong></p>)}</div></details> : null}
    <Button size="sm" variant="primary" className={`reading-word-save ${added ? "added" : ""}`} onClick={onToggleVocabulary} type="button">{added ? "✓ 已加入生词本（点击移除）" : "＋ 加入生词本"}</Button>
  </div>;
}

type WordPanelVocabEntry = { partOfSpeech?: string; meaning: string };

function WordPanel({ word, vocabEntry, queryResult, britishPhonetic, americanPhonetic, added, contextStatus, contextPanels, onRequestContext, onToggleVocabulary, onSpeak }: { word: string; vocabEntry?: WordPanelVocabEntry; queryResult: QueryResult | null; britishPhonetic: string; americanPhonetic: string; added: boolean; contextStatus: "idle" | "loading" | "done"; contextPanels: QueryPanel[] | null; onRequestContext: () => void; onToggleVocabulary: () => void; onSpeak: (lang: "en-GB" | "en-US") => void }) {
  const dictionaryEntry = queryResult?.kind === "word" ? queryResult.entries[0] : undefined;
  const loading = queryResult?.kind === "word" && queryResult.status === "loading";
  return <div className="reading-panel-content"><div className="reading-word-title">{word}</div><div className="reading-phon-chips"><Button size="sm" variant="secondary" aria-label={`🔊 英 ${britishPhonetic || "—"}`} onClick={() => onSpeak("en-GB")} type="button"><Volume2 aria-hidden="true" size={14} />英 {britishPhonetic || "—"}</Button><Button size="sm" variant="secondary" aria-label={`🔊 美 ${americanPhonetic || "—"}`} onClick={() => onSpeak("en-US")} type="button"><Volume2 aria-hidden="true" size={14} />美 {americanPhonetic || "—"}</Button></div>
    {vocabEntry ? <><div className="reading-pos">{vocabEntry.partOfSpeech}</div><div className="reading-meaning">{vocabEntry.meaning.split("\n").filter(Boolean).join("；")}</div></>
      : dictionaryEntry?.meanings.length ? <div className="reading-meaning">{dictionaryEntry.meanings.map((group) => <div className="reading-meaning-group" key={group.partOfSpeech || "meaning"}>{group.partOfSpeech && <span className="reading-pos">{group.partOfSpeech}</span>}{group.translations.join("；")}</div>)}</div>
        : <div className="reading-meaning">{loading ? "正在查询本地词典…" : "暂无中文释义"}</div>}
    <Button size="sm" variant="primary" className={`reading-add-btn ${added ? "added" : ""}`} onClick={onToggleVocabulary} type="button">{added ? "✓ 已加入生词本（点击移除）" : "＋ 加入生词本"}</Button>
    <div className="reading-context-block">
      {contextStatus === "idle" && <Button size="sm" variant="secondary" className="reading-context-button" onClick={onRequestContext} title="结合当前句子，让 AI 说明这个词在本文中的意思" type="button"><Sparkles aria-hidden="true" size={14} />查看在本文中的意思</Button>}
      {contextStatus === "loading" && <p className="reading-context-status">正在调用 AI 翻译…</p>}
      {contextPanels?.map((panel) => <section className="reading-translation-card" key={panel.id}><div className="reading-panel-label">{panel.label}<span>{panel.badge}</span></div><strong>{panel.title}</strong><p>{panel.body}</p></section>)}
    </div></div>;
}

function TranslationPanel({ result, onRetry }: { result: QueryResult; onRetry: () => void }) {
  return <div className="reading-panel-content reading-translation-result">
    <div className="reading-translation-source">{result.query}</div>
    {result.panels.filter(panel => !isAiPanelId(panel.id)).map(panel => <section className="reading-translation-card" key={panel.id}>
      <div className="reading-panel-label">{panel.label}{panel.badge && <span>{panel.badge}</span>}</div>
      {panel.title && <strong>{panel.title}</strong>}<p>{panel.body}</p>
    </section>)}
    {result.status === "error" && <Button size="sm" variant="secondary" onClick={onRetry} type="button">重试本地翻译</Button>}
    <OptionalAiPanel key={result.query} query={result.query} mode={result.kind} register="news" />
  </div>;
}

function NotesPanel({ annotations, composerOpen, composerSource, composerText, onCancel, onChange, onRemove, onSave }: { annotations: ReadingAnnotation[]; composerOpen: boolean; composerSource: string; composerText: string; onCancel: () => void; onChange: (value: string) => void; onRemove: (annotation: ReadingAnnotation) => void; onSave: () => void }) {
  return <div className="reading-panel-content"><div className={`reading-annotation-composer ${composerOpen ? "" : "hidden"}`}><div className="reading-composer-label">为选中的内容添加批注</div><div className="reading-annotation-source">{composerSource}</div><textarea aria-label="批注内容" className="reading-annotation-input" onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") onCancel(); if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSave(); } }} placeholder="写下你的想法……" value={composerText} /><div className="reading-annotation-actions"><Button size="sm" variant="ghost" onClick={onCancel} type="button">取消</Button><Button size="sm" variant="secondary" onClick={onSave} type="button">保存</Button></div></div>{annotations.filter((item) => item.kind === "note").map((item) => <article className="reading-note-card" data-annotation-id={item.id} key={item.id}><div className="reading-note-quote">{item.quote}</div><div className="reading-note-text">{item.note}</div><Button size="sm" variant="destructive" onClick={() => onRemove(item)} type="button">移除</Button></article>)}</div>;
}

function getRangeOffsets(root: HTMLElement, range: Range) {
  const beforeStart = document.createRange(); beforeStart.selectNodeContents(root); beforeStart.setEnd(range.startContainer, range.startOffset);
  const beforeEnd = document.createRange(); beforeEnd.selectNodeContents(root); beforeEnd.setEnd(range.endContainer, range.endOffset);
  return { start: beforeStart.toString().length, end: beforeEnd.toString().length };
}

function isEnglishWordCharacter(value: string | undefined) { return Boolean(value && /[A-Za-z]/.test(value)); }

/** Caret at a viewport point; Chromium exposes caretRangeFromPoint, Firefox caretPositionFromPoint. */
function rangeFromPoint(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (pointX: number, pointY: number) => Range | null;
    caretPositionFromPoint?: (pointX: number, pointY: number) => { offsetNode: Node; offset: number } | null;
  };
  const direct = doc.caretRangeFromPoint?.(x, y);
  if (direct) return direct;
  const position = doc.caretPositionFromPoint?.(x, y);
  if (!position) return null;
  const range = document.createRange();
  range.setStart(position.offsetNode, position.offset);
  range.collapse(true);
  return range;
}

/** True for a single lookup word such as "manifestation", "don't" or "well-known". */
export function isSingleWord(value: string) {
  return /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/.test(value.trim());
}

/**
 * Sentence the selection sits in, plus one neighbouring sentence on each side. Context is only
 * ever sent for the contextual word card, so it stays short on purpose.
 */
export function getSelectionSentence(range: Range, maxLength = 600) {
  const container = range.startContainer.parentElement;
  const element = (container?.closest("p, li, blockquote, h2, h3") ?? container) as HTMLElement | null;
  const text = element?.textContent?.trim() ?? "";
  if (!element || !text) return "";
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]*/g) ?? [text];
  let cursor = 0;
  const spans = sentences.map((sentence) => {
    const start = Math.max(cursor, text.indexOf(sentence, cursor));
    const end = start + sentence.length;
    cursor = end;
    return { start, end, text: sentence.trim() };
  });
  const offsets = getRangeOffsets(element, range);
  const index = spans.findIndex((span) => offsets.start >= span.start && offsets.start < span.end);
  const from = index < 0 ? 0 : Math.max(0, index - 1);
  const to = index < 0 ? 0 : Math.min(spans.length - 1, index + 1);
  const context = spans.slice(from, to + 1).map((span) => span.text).filter(Boolean).join(" ");
  return context.length > maxLength ? context.slice(0, maxLength) : context;
}

export function expandRangeToWordBoundaries(root: HTMLElement, range: Range) {
  const startNode = range.startContainer;
  const endNode = range.endContainer;
  const startText = startNode.nodeType === Node.TEXT_NODE ? startNode.textContent ?? "" : "";
  const endText = endNode.nodeType === Node.TEXT_NODE ? endNode.textContent ?? "" : "";
  // Expansion stays inside the boundary text nodes, so a selection that starts a paragraph never
  // swallows the last word of the previous paragraph.
  if (!startText || !endText || !root.contains(startNode) || !root.contains(endNode)) return range.cloneRange();
  let start = Math.max(0, Math.min(range.startOffset, startText.length));
  let end = Math.max(0, Math.min(range.endOffset, endText.length));
  if (startNode === endNode) {
    while (start > 0 && isEnglishWordCharacter(startText[start - 1]) && isEnglishWordCharacter(startText[start])) start -= 1;
  }
  while (end < endText.length && isEnglishWordCharacter(endText[end - 1]) && isEnglishWordCharacter(endText[end])) end += 1;
  const expanded = document.createRange();
  expanded.setStart(startNode, start);
  expanded.setEnd(endNode, end);
  return expanded;
}

export function getSelectionToolbarPosition(range: Range, anchor?: SelectionToolbarAnchor) {
  const rect = (range as Range & { getBoundingClientRect?: () => DOMRect }).getBoundingClientRect?.() ?? ({ left: 8, right: 8, top: 8, bottom: 8, width: 0, height: 0 } as DOMRect);
  const viewportWidth = window.innerWidth || 1024;
  const viewportHeight = window.innerHeight || 768;
  const gap = 10;
  // Prefer the point where the user released the mouse. Align the translation action to that
  // point, leaving the rest of the toolbar to its right. A Range is only the fallback.
  const anchorX = anchor?.x ?? rect.left;
  const anchorY = anchor?.source === "word" ? rect.bottom : anchor?.y ?? rect.bottom;
  const left = Math.max(8, Math.min(viewportWidth - SELECTION_TOOLBAR_WIDTH - 8, anchorX - (anchor ? SELECTION_TRANSLATE_CENTER_OFFSET : 0)));
  const roomBelow = anchorY + gap + SELECTION_TOOLBAR_HEIGHT + SELECTION_PALETTE_HEIGHT <= viewportHeight - 8;
  const top = roomBelow
    ? anchorY + gap
    : Math.max(8, (anchor ? anchorY : rect.top) - gap - SELECTION_TOOLBAR_HEIGHT);
  return { left, top, placement: roomBelow ? "below" as const : "above" as const };
}

function rangesMatch(first: Range, second: Range) {
  return first.startContainer === second.startContainer
    && first.startOffset === second.startOffset
    && first.endContainer === second.endContainer
    && first.endOffset === second.endOffset;
}

export function hasSelectionHighlight(annotations: ReadingAnnotation[], offsets: { start: number; end: number }) {
  return annotations.some((annotation) => annotation.kind === "highlight" && annotation.start < offsets.end && annotation.end > offsets.start);
}

function rangeFromOffsets(root: HTMLElement, start: number, end: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let position = 0; let startPoint: { node: Node; offset: number } | undefined; let endPoint: { node: Node; offset: number } | undefined;
  while (walker.nextNode()) { const node = walker.currentNode; const length = node.textContent?.length ?? 0; if (!startPoint && start >= position && start <= position + length) startPoint = { node, offset: start - position }; if (!endPoint && end >= position && end <= position + length) { endPoint = { node, offset: end - position }; break; } position += length; }
  if (!startPoint || !endPoint) return null; const range = document.createRange(); range.setStart(startPoint.node, startPoint.offset); range.setEnd(endPoint.node, endPoint.offset); return range;
}

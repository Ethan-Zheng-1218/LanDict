import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Copy, Star, Volume2, X } from "@/components/ui/icon";
import { normalizeVocabularyWord, removeVocabulary, saveVocabulary, useVocabulary } from "../vocabulary/vocabularyStore";
import { resolveQuery } from "../translation/translationService";
import { describeAiError, requestAiPanels } from "../translation/aiTranslationProvider";
import { fetchWordPronunciation } from "../translation/pronunciationService";
import { getSpeechVoice } from "../reading/speech";
import { copyHoverContent } from "./hoverActions";
import type { HoverSample } from "./types";

type HoverLookupCardProps = { sample: HoverSample; onClose?: () => void; onActivate?: () => void; onResize?: (width: number, height: number) => void };

export function HoverLookupCard({ sample, onClose, onActivate, onResize }: HoverLookupCardProps) {
  const vocabulary = useVocabulary();
  const collectedEntry = vocabulary.find(entry => entry.word === normalizeVocabularyWord(sample.word));
  const collected = Boolean(collectedEntry);
  const [saveError, setSaveError] = useState("");
  const [result, setResult] = useState({ id: sample.id, meaning: "正在查询中文释义…", ai: "正在解释当前句子…", ipa: "" });
  const [copyStatus, setCopyStatus] = useState("");
  const [aiExpanded, setAiExpanded] = useState(false);
  const aiController = useRef<AbortController | null>(null);
  const card = useRef<HTMLDivElement | null>(null);
  const measuredWidth = useRef<{ id: number; width: number } | null>(null);
  const britishAudio = useRef<string | undefined>(undefined);
  const activeAudio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setCopyStatus("");
    setSaveError("");
    setAiExpanded(false);
    britishAudio.current = undefined;
    setResult({ id: sample.id, meaning: "正在查询中文释义…", ai: sample.context ? "" : "未获取到当前句子", ipa: "" });
    /* 和其它页面同一条发音链路：英式免费音频 → 有道真人录音 → 系统语音。 */
    void fetchWordPronunciation(sample.word, controller.signal).then((pronunciation) => {
      if (!controller.signal.aborted) britishAudio.current = pronunciation.british.audioUrl;
    }).catch(() => {});
    void resolveQuery(sample.word, controller.signal, { ai: false }).then((value) => {
      if (controller.signal.aborted) return;
      const meaning = value.kind === "word" && value.status !== "error" ? value.meaning : "本地词库暂时不可用";
      const ipa = value.kind === "word" && value.britishPhonetic !== "—" ? value.britishPhonetic : "";
      setResult((previous) => ({ ...previous, meaning, ipa }));
    }).catch(() => {
      if (!controller.signal.aborted) setResult((previous) => ({ ...previous, meaning: "本地词库暂时不可用" }));
    });
    return () => { controller.abort(); aiController.current?.abort(); activeAudio.current?.pause(); activeAudio.current = null; window.speechSynthesis?.cancel(); };
  }, [sample.id, sample.word, sample.context]);

  useLayoutEffect(() => {
    if (!card.current || !onResize) return;
    const element = card.current;
    const measure = () => {
      const word = element.querySelector<HTMLElement>("[data-word-measure]");
      const header = element.querySelector<HTMLElement>('[data-slot="card-header"]');
      const content = element.querySelector<HTMLElement>('[data-slot="card-content"]');
      const footer = element.querySelector<HTMLElement>('[data-slot="card-footer"]');
      // Freeze width for this target; dictionary/AI updates must not change text wrapping again.
      if (measuredWidth.current?.id !== sample.id) {
        measuredWidth.current = { id: sample.id, width: Math.min(480, Math.max(228, Math.ceil((word?.getBoundingClientRect().width ?? 0) + 120))) };
      }
      const width = measuredWidth.current.width;
      const height = Math.min(360, Math.max(180, Math.ceil((header?.offsetHeight ?? 0) + (content?.scrollHeight ?? 0) + (footer?.offsetHeight ?? 0) + 58)));
      onResize(width, height);
    };
    let disposed = false;
    let frame = 0;
    const schedule = () => {
      if (disposed) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    schedule();
    void document.fonts?.ready.then(schedule);
    let viewportWidth = window.innerWidth;
    const onWidthChange = () => {
      if (window.innerWidth === viewportWidth) return;
      viewportWidth = window.innerWidth;
      schedule();
    };
    window.addEventListener("resize", onWidthChange);
    // The card height follows the native viewport. Observing that height feeds our own
    // set_size back into measurement. Only content or an actual width change needs a pass.
    return () => { disposed = true; cancelAnimationFrame(frame); window.removeEventListener("resize", onWidthChange); };
  }, [sample.id, result, copyStatus, saveError, aiExpanded, onResize]);

  function toggleAi() {
    setAiExpanded(!aiExpanded);
    if (aiExpanded || !sample.context || result.ai) return;
    const controller = new AbortController();
    aiController.current = controller;
    setResult(previous => ({ ...previous, ai: "正在解释当前句子…" }));
    void requestAiPanels({ text: sample.word, mode: "word", context: sample.context }, controller.signal).then(panels => {
      if (!controller.signal.aborted) setResult(previous => ({ ...previous, ai: panels.map(panel => panel.body).join("\n") || "AI 未返回语境义" }));
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setResult(previous => ({ ...previous, ai: describeAiError(error) }));
    });
  }

  function pronounce() {
    activeAudio.current?.pause();
    const speak = () => {
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(sample.word);
      utterance.lang = "en-GB";
      const voice = getSpeechVoice("en-GB");
      utterance.voice = voice?.lang.replace("_", "-").toLowerCase().startsWith("en-gb") ? voice : null;
      utterance.rate = 0.92;
      window.speechSynthesis.speak(utterance);
    };
    if (britishAudio.current) {
      window.speechSynthesis?.cancel();
      const audio = new Audio(britishAudio.current);
      activeAudio.current = audio;
      void audio.play().catch(() => { if (activeAudio.current === audio) speak(); });
    } else speak();
  }

  const current = result.id === sample.id ? result : { meaning: "正在查询中文释义…", ai: sample.context ? "正在解释当前句子…" : "未获取到当前句子", ipa: "" };
  function toggleCollection() {
    try {
      if (collectedEntry) {
        removeVocabulary(collectedEntry.id);
        setSaveError("");
        return;
      }
      saveVocabulary({
        word: sample.word,
        meaning: current.meaning === "正在查询中文释义…" || current.meaning === "本地词库暂时不可用" ? "待补充释义" : current.meaning,
        britishPhonetic: current.ipa,
        example: sample.context,
        source: "鼠标取词",
        sourceType: "lookup",
      });
      setSaveError("");
    } catch { setSaveError("收藏失败，请重试"); }
  }
  async function copy() {
    try {
      await copyHoverContent(`${sample.word}\n\n中文释义\n${current.meaning}\n\nAI 语境义\n${current.ai}`);
      setCopyStatus("已复制");
    } catch { setCopyStatus("复制失败，请选中文字复制"); }
  }

  return <div ref={card} onPointerDownCapture={onActivate}><Card className="hover-lookup-card" aria-label="鼠标取词">
    <CardHeader>
      <span className="hover-lookup-word-measure" data-word-measure aria-hidden="true">{sample.word}</span>
      <div className="hover-lookup-heading">
        <CardTitle><h1>{sample.word}</h1></CardTitle>
        <IconButton label={collected ? "取消收藏" : "收藏到本地生词本"} aria-pressed={collected} className="hover-lookup-collect" size="icon-xs" onClick={toggleCollection} type="button"><Star fill={collected ? "currentColor" : "none"} /></IconButton>
        <IconButton label="关闭取词窗口" className="hover-lookup-close" size="icon-xs" onClick={onClose} type="button"><X /></IconButton>
      </div>
      {current.ipa && <button className="hover-lookup-phonetic" aria-label="英式发音" onClick={pronounce} type="button"><Volume2 />英 /{current.ipa.replace(/^\/+|\/+$/g, "")}/</button>}
      {saveError && <span className="hover-lookup-copy-status" role="status">{saveError}</span>}
    </CardHeader>
    <CardContent>
      <section><h2>中文释义</h2><p>{current.meaning.replace(/\n+/g, "；")}</p></section>
      <section>{sample.context ? <>
        <button className="hover-lookup-ai-toggle" aria-label={`${aiExpanded ? "收起" : "展开"}AI解释`} aria-expanded={aiExpanded} onClick={toggleAi} type="button"><h2>AI解释</h2></button>
        {aiExpanded ? <p aria-live="polite">{current.ai}</p> : <p>展开后调用 AI，可能产生接口费用。</p>}
      </> : <><h2>AI解释</h2><p>未获取到当前句子</p></>}</section>
    </CardContent>
    <CardFooter>
      <Button aria-label="复制内容" variant="ghost" size="sm" onClick={() => void copy()} type="button"><Copy data-icon="inline-start" />复制内容</Button>
      {copyStatus && <span className="hover-lookup-copy-status" role="status">{copyStatus}</span>}
    </CardFooter>
  </Card></div>;
}

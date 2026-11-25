import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, Languages } from "@/components/ui/icon";
import { loadAiPanels, type QueryPanel } from "./translationService";
import type { AiTranslationMode } from "./aiTranslationProvider";
import { isEnglishLearningWord, type AiLearningCategory } from "./aiLearning";
import { isQueryAiEnabled, loadSettings, SETTINGS_CHANGED_EVENT } from "../settings/settingsStore";
import { LookupText } from "./LookupText";

const CATEGORIES: { id: AiLearningCategory; label: string }[] = [
  { id: "examples", label: "例句" }, { id: "roots", label: "词根" },
  { id: "synonyms", label: "近义词" }, { id: "antonyms", label: "反义词" }, { id: "derivatives", label: "派生词" },
];
function LearningText({ text, onLookup }: { text: string; onLookup?: (word: string) => void }) {
  return <div className="ai-learning-text">{text.trim().split(/\n\s*\n|\n(?=\d+[.、．)])/).filter(Boolean).map((block, index) => {
    const [first, ...rest] = block.split("\n");
    return /^\d+[.、．)]\s*/.test(first)
      ? <section className="ai-learning-section" key={index}><h3><LookupText text={first} onLookup={onLookup} /></h3>{rest.length > 0 && <p><LookupText text={rest.join("\n")} onLookup={onLookup} /></p>}</section>
      : <p key={index}><LookupText text={block} onLookup={onLookup} /></p>;
  })}</div>;
}
export function OptionalAiPanel({ query, mode, context, register, ready = true, onLookup }: {
  query: string; mode: AiTranslationMode; context?: string; register?: "neutral" | "news"; ready?: boolean; onLookup?: (word: string) => void;
}) {
  const wordLearning = mode === "word" && isEnglishLearningWord(query);
  const defaultCategory = wordLearning ? "examples" : undefined;
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [panels, setPanels] = useState<QueryPanel[] | null>(null);
  const [category, setCategory] = useState<AiLearningCategory | undefined>(defaultCategory);
  const [autoAi, setAutoAi] = useState(isQueryAiEnabled);
  const [providerSettings, setProviderSettings] = useState(() => JSON.stringify(loadSettings().translation));
  const controller = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, QueryPanel[]>());
  const contentRef = useRef<HTMLDivElement>(null);
  const bodyId = useId();
  useEffect(() => {
    const refresh = () => { setProviderSettings(JSON.stringify(loadSettings().translation)); setAutoAi(isQueryAiEnabled()); };
    window.addEventListener(SETTINGS_CHANGED_EVENT, refresh); window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(SETTINGS_CHANGED_EVENT, refresh); window.removeEventListener("storage", refresh); };
  }, []);
  useEffect(() => {
    cache.current.clear(); setCategory(defaultCategory);
    setExpanded(autoAi && ready); setLoading(false); setPanels(null);
    if (autoAi && ready) void load(defaultCategory);
    return () => controller.current?.abort();
  }, [query, mode, context, register, autoAi, ready, providerSettings]);
  async function load(next: AiLearningCategory | undefined, retry = false) {
    controller.current?.abort(); setCategory(next);
    if (contentRef.current) contentRef.current.scrollTop = 0;
    const key = next ?? "translation", saved = retry ? undefined : cache.current.get(key);
    if (saved) { setPanels(saved); setLoading(false); return; }
    const request = new AbortController(); controller.current = request;
    setLoading(true); setPanels(null);
    const result = await loadAiPanels(query, { mode, context, register, ...(next ? { learning: next } : {}) }, request.signal);
    if (request.signal.aborted) return;
    if (!result.some(panel => panel.id === "ai-error")) cache.current.set(key, result);
    setPanels(result); setLoading(false);
  }
  function toggle() { setExpanded(!expanded); if (!expanded && panels === null && !loading) void load(category); }
  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowRight" ? (index + 1) % CATEGORIES.length : event.key === "ArrowLeft" ? (index + CATEGORIES.length - 1) % CATEGORIES.length : event.key === "Home" ? 0 : event.key === "End" ? CATEGORIES.length - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault(); document.getElementById(`${bodyId}-${CATEGORIES[next].id}`)?.focus(); void load(CATEGORIES[next].id);
  }
  return <Card role="article" className={expanded ? "provider-panel expanded" : "provider-panel"} data-testid="provider-panel-ai">
    <CardHeader className="provider-panel-header"><Button variant="ghost" size="preserve" className="provider-panel-toggle" aria-label={`${expanded ? "收起" : "展开"}AI 翻译`} aria-expanded={expanded} aria-controls={bodyId} onClick={toggle} disabled={!ready} type="button">
      <span className="provider-name"><Languages data-icon="inline-start" />AI 翻译</span><ChevronDown data-icon="inline-end" aria-hidden="true" />
    </Button></CardHeader>
    {expanded && <CardContent className="provider-panel-body query-ai-combined" id={bodyId}>
      {wordLearning && <div className="ai-learning-tabs" role="tablist" aria-label="AI 单词学习">{CATEGORIES.map((item, index) => <Button key={item.id} id={`${bodyId}-${item.id}`} role="tab" aria-selected={category === item.id} aria-controls={`${bodyId}-learning`} tabIndex={category === item.id ? 0 : -1} variant="ghost" size="sm" className="ai-learning-tab" onClick={() => { if (category !== item.id) void load(item.id); }} onKeyDown={event => moveTab(event, index)} type="button">{item.label}</Button>)}</div>}
      <div ref={contentRef} className={wordLearning ? "ai-learning-content" : "ai-translation-content"} {...(wordLearning ? { role: "tabpanel", id: `${bodyId}-learning`, "aria-labelledby": `${bodyId}-${category}`, tabIndex: 0 } : {})} aria-busy={loading}>
        {loading ? <p role="status">正在调用 AI 翻译…</p> : panels?.map(panel => <section className="query-ai-variant" key={panel.id}>
          {panel.title && <h2><LookupText text={panel.title} onLookup={panel.id === "ai-error" ? undefined : onLookup} /></h2>}
          {panel.id === "ai-error" ? <p>{panel.body}</p> : wordLearning ? <LearningText text={panel.body} onLookup={onLookup} /> : <p><LookupText text={panel.body} onLookup={onLookup} /></p>}
        </section>)}
      </div>
      {!loading && panels?.some(p => p.id === "ai-error") && <Button variant="secondary" size="sm" onClick={() => void load(category, true)} type="button">重试AI翻译</Button>}
    </CardContent>}
  </Card>;
}

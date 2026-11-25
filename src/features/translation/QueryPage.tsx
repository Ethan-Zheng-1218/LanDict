import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { BookOpen, ChevronDown, Languages, Star, Volume2 } from "@/components/ui/icon";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { addHistory, listHistory } from "../history/historyStore";
import { addLearningEvent } from "../learning/learningStore";
import { removeVocabulary, saveVocabulary, useVocabulary } from "../vocabulary/vocabularyStore";
import { getQueryResult, isAiPanelId, isChineseWord, resolveQuery, type QueryPanel } from "./translationService";
import { DictionaryPanel } from "./DictionaryPanel";
import { fetchWordPronunciation, pronunciationAudioLabel, type WordPronunciation } from "./pronunciationService";
import { OptionalAiPanel } from "./OptionalAiPanel";
import { QuerySearchBox } from "./QuerySearchBox";
import { LookupText } from "./LookupText";

function speak(text: string, lang: "en-GB" | "en-US") {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 0.92;
  window.speechSynthesis.speak(utterance);
}

function playPronunciation(text: string, lang: "en-GB" | "en-US", audioUrl?: string) {
  if (audioUrl && typeof Audio !== "undefined") {
    const audio = new Audio(audioUrl);
    void audio.play().catch(() => speak(text, lang));
    return;
  }
  speak(text, lang);
}

function getLemmaNotice(resolvedWord: string, formLabel?: string) {
  return `${resolvedWord}的${formLabel ?? "词形"}形式`;
}

export function QueryPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q")?.trim() || "";
  const [input, setInput] = useState(query);
  const submittedQuery = useRef<string | null>(null);

  useEffect(() => {
    if (submittedQuery.current !== query) setInput(query);
    submittedQuery.current = null;
  }, [query]);

  function submitQuery(value: string) {
    const normalized = value.trim();
    if (!normalized) return;
    setInput(value);
    submittedQuery.current = normalized;
    if (normalized === query) setRetryVersion(version => version + 1);
    else setParams({ q: normalized });
  }
  const result = useMemo(() => query ? getQueryResult(query) : null, [query]);
  const [displayedResult, setDisplayedResult] = useState(result);
  const [isLoading, setIsLoading] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const [expandedPanelIds, setExpandedPanelIds] = useState<Set<string>>(
    () => new Set(displayedResult?.panels[0] && !isAiPanelId(displayedResult.panels[0].id) ? [displayedResult.panels[0].id] : []),
  );
  const [wordPronunciation, setWordPronunciation] = useState<WordPronunciation | null>(null);
  const vocabulary = useVocabulary();
  const lookupWord = displayedResult?.kind === "word" ? displayedResult.resolvedWord ?? displayedResult.correctedWord ?? displayedResult.query : query;
  const isReverseLookup = displayedResult?.kind === "word" && isChineseWord(displayedResult.query);
  const britishPhonetic = wordPronunciation?.british.ipa || "—";
  const americanPhonetic = wordPronunciation?.american.ipa || "—";
  const savedEntry = displayedResult?.kind === "word"
    ? vocabulary.find((entry) => entry.word.toLowerCase() === lookupWord.toLowerCase())
    : undefined;

  useEffect(() => {
    if (query) return;
    const latestQuery = listHistory()[0]?.query;
    if (latestQuery) setParams({ q: latestQuery }, { replace: true });
  }, [query, setParams]);

  useEffect(() => {
    setDisplayedResult(result);
    if (!result) { setIsLoading(false); return; }
    const controller = new AbortController();
    setIsLoading(true);
    void resolveQuery(query, controller.signal, { spelling: true })
      .then(loaded => { if (!controller.signal.aborted) setDisplayedResult(loaded); })
      .catch(() => { if (!controller.signal.aborted) setDisplayedResult({ ...result, status: "error" }); })
      .finally(() => { if (!controller.signal.aborted) setIsLoading(false); });
    return () => controller.abort();
  }, [query, result, retryVersion]);

  useEffect(() => {
    setWordPronunciation(null);
    if (!lookupWord || !displayedResult || displayedResult.kind !== "word" || isChineseWord(lookupWord) || typeof fetch !== "function") return;
    const controller = new AbortController();
    void fetchWordPronunciation(lookupWord, controller.signal, (pronunciation) => {
      if (!controller.signal.aborted) setWordPronunciation(pronunciation);
    }).then((pronunciation) => {
      if (!controller.signal.aborted) setWordPronunciation(pronunciation);
    });
    return () => controller.abort();
  }, [lookupWord, displayedResult]);

  useEffect(() => {
    if (!query || !result) return;
    addHistory({ query, kind: result.kind, source: result.kind === "word" ? result.source : "本地翻译" });
    addLearningEvent({ type: "lookup", label: query });
  }, [query, result, retryVersion]);

  useEffect(() => {
    if (!query || !displayedResult || displayedResult.query !== query || displayedResult.status === "loading") return;
    const preview = displayedResult.kind === "word"
      ? displayedResult.meaning
      : displayedResult.status === "success"
        ? displayedResult.panels[0]?.body ?? ""
        : "";
    addHistory({ query, kind: displayedResult.kind, preview,
      source: displayedResult.kind === "word" ? displayedResult.source : displayedResult.panels.find(panel => panel.id === "local")?.title === "有道词典" ? "有道词典" : "本地翻译" });
  }, [query, displayedResult]);

  const panels: QueryPanel[] = displayedResult?.panels ?? [];
  const standalonePanels = panels.filter((panel) => !isAiPanelId(panel.id));

  useEffect(() => {
    const first = result?.panels[0];
    setExpandedPanelIds(new Set(first && !isAiPanelId(first.id) ? [first.id] : []));
  }, [result]);

  function togglePanel(panelId: string) {
    setExpandedPanelIds(current => {
      const next = new Set(current);
      if (next.has(panelId)) next.delete(panelId); else next.add(panelId);
      return next;
    });
  }

  function toggleSavedWord() {
    if (!displayedResult || displayedResult.kind !== "word") return;
    if (savedEntry) {
      removeVocabulary(savedEntry.id);
      return;
    }
    const preferredEntry = displayedResult.entries[0];
    saveVocabulary({
      word: lookupWord,
      phonetic: wordPronunciation?.british.ipa || "",
      britishPhonetic: wordPronunciation?.british.ipa || "",
      americanPhonetic: wordPronunciation?.american.ipa || "",
      meaning: displayedResult.meaning,
      definition: preferredEntry?.definition,
      partOfSpeech: preferredEntry?.partOfSpeech,
      collocations: preferredEntry?.collocations,
      collocationTranslations: preferredEntry?.collocationTranslations,
      examples: preferredEntry?.examples,
      example: preferredEntry?.example ?? displayedResult.example,
      source: displayedResult.source,
      sourceType: "lookup",
    });
  }

  const queryControls = <div className="query-controls">
    <QuerySearchBox value={input} activeQuery={query} onChange={setInput} onSearch={submitQuery} />
  </div>;

  if (!displayedResult) {
    return (
      <section className="query-page query-page-empty">
        {queryControls}
        <div className="query-empty-state">
          <span className="query-empty-icon" aria-hidden="true"><Languages /></span>
          <h2>开始一次新的查询</h2>
          <p>在上方输入单词、短语、句子或中文，结果会显示在这里。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="query-page">
      {queryControls}
      <PageHeader className={displayedResult.kind === "word" ? "query-header query-header-word" : "query-header query-header-long"} headingLevel={2} title={query} actionsInline actions={displayedResult.kind === "word" && !isReverseLookup && (
          <Button variant="ghost" size="sm" aria-pressed={Boolean(savedEntry)} className={savedEntry ? "save-word-button saved" : "save-word-button"} onClick={toggleSavedWord} type="button"><Star />{savedEntry ? "已加入生词本" : "加入生词本"}</Button>
        )}>
          {displayedResult.kind === "word" && displayedResult.correctedWord && <p className="query-spelling-notice" role="status">拼写可能有误，已为你显示 <button type="button" onClick={() => submitQuery(displayedResult.correctedWord!)}>{displayedResult.correctedWord}</button> 的解释。</p>}
          {displayedResult.kind === "word" && Boolean(displayedResult.spellingSuggestions?.length) && <p className="query-spelling-notice">你可能想查：{displayedResult.spellingSuggestions!.map(word => <button key={word} type="button" onClick={() => submitQuery(word)}>{word}</button>)}</p>}
          {displayedResult.kind === "word" && displayedResult.resolvedWord && !displayedResult.correctedWord && (
            <p className="query-lemma-notice">
              {getLemmaNotice(
                displayedResult.resolvedWord,
                displayedResult.entries[0]?.wordForms.find((form) => form.value.toLowerCase() === query.toLowerCase())?.label,
              )}
            </p>
          )}
          {displayedResult.kind === "word" && !isReverseLookup && (
            <div className="pronunciation-row">
              <Button size="sm" variant="ghost" aria-label={`英 ${britishPhonetic}`} data-online-audio-url={wordPronunciation?.british.audioUrl} onClick={() => playPronunciation(lookupWord, "en-GB", wordPronunciation?.british.audioUrl)} title={pronunciationAudioLabel(wordPronunciation?.british.audioSource ?? "system-tts", "uk")} type="button"><Volume2 size={16} />英 {britishPhonetic}</Button>
              <Button size="sm" variant="ghost" aria-label={`美 ${americanPhonetic}`} data-online-audio-url={wordPronunciation?.american.audioUrl} onClick={() => playPronunciation(lookupWord, "en-US", wordPronunciation?.american.audioUrl)} title={pronunciationAudioLabel(wordPronunciation?.american.audioSource ?? "system-tts", "us")} type="button"><Volume2 size={16} />美 {americanPhonetic}</Button>
            </div>
          )}
      </PageHeader>
        {isLoading && <p aria-live="polite" className="query-status" role="status">{displayedResult.kind === "word" ? "正在查询词库…" : "正在使用内置模型翻译…"}</p>}
        {displayedResult.kind === "word" && !isLoading && displayedResult.status === "error" && <p aria-live="polite" className="query-status" role="status">词库暂时不可用，请稍后重试。</p>}
        {displayedResult.kind === "word" && !isLoading && displayedResult.status === "empty" && <p aria-live="polite" className="query-status" role="status">暂时没有找到适合展示的词典结果。</p>}

      <div className="provider-list" data-testid="query-results">
        {standalonePanels.map((panel) => (
          <Card role="article"
            className={expandedPanelIds.has(panel.id) ? "provider-panel expanded" : "provider-panel"}
            data-testid={`provider-panel-${panel.id}`}
            key={panel.id}
          >
            <CardHeader className="provider-panel-header">
              <button
                aria-controls={`provider-panel-body-${panel.id}`}
                aria-expanded={expandedPanelIds.has(panel.id)}
                aria-label={`${expandedPanelIds.has(panel.id) ? "收起" : "展开"}${panel.label}`}
                className="provider-panel-toggle"
                onClick={() => togglePanel(panel.id)}
                type="button"
              >
                <span className="provider-name">{panel.id === "ecdict" ? <BookOpen /> : <Languages />}{panel.label}</span>
                {panel.id !== "local" && panel.title && <span className="provider-panel-summary">{panel.title}</span>}
                <ChevronDown aria-hidden="true" />
              </button>
            </CardHeader>
            {expandedPanelIds.has(panel.id) && (
              <CardContent className="provider-panel-body" id={`provider-panel-body-${panel.id}`}>
                {displayedResult.kind === "word" && panel.id === "ecdict" ? (() => {
                  const entries = displayedResult.entries;
                  return entries.length ? <div className="dictionary-candidate-list">{entries.map((entry) => <DictionaryPanel entry={entry} compact={isReverseLookup} onLookup={submitQuery} key={entry.word} />)}</div> : <p><LookupText text={panel.body} onLookup={submitQuery} /></p>;
                })() : <p><LookupText text={panel.body} onLookup={submitQuery} /></p>}
              </CardContent>
            )}
          </Card>
        ))}
        {displayedResult.kind !== "word" && displayedResult.status === "error" && <Button variant="secondary" size="sm" onClick={() => setRetryVersion(v => v + 1)} type="button">重试本地翻译</Button>}
        {result && <OptionalAiPanel key={query} query={displayedResult.kind === "word" ? displayedResult.correctedWord ?? query : query} mode={result.kind} onLookup={submitQuery} ready={result.kind !== "word" || (displayedResult.query === query && displayedResult.status !== "loading")} />}

      </div>
    </section>
  );
}

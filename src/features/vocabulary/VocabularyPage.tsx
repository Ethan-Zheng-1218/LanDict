import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { SearchBox } from "@/components/ui/search-box";
import { ArrowDownAZ, Bookmark, BookOpen, Check, ChevronDown, Download, Eye, EyeOff, Graduate, Search, Upload, Volume2, X } from "@/components/ui/icon";

import { adaptEcdictRecord } from "../translation/ecdictAdapter";
import { fetchWordPronunciation } from "../translation/pronunciationService";
import { dedupeMeaningText } from "../../lib/meaningText";
import { IMPORT_MISSING_MEANING, IMPORT_SOURCE_LABEL, MAX_IMPORT_BYTES, parseVocabularyImport, readImportFileText, type VocabularyImportResult } from "./vocabularyImport";
import { saveVocabularyBackup } from "./vocabularyBackup";
import { addVocabularyEntries, removeVocabulary, restoreVocabulary, saveVocabulary, updateVocabulary, updateVocabularyPronunciation, useVocabulary, VOCABULARY_STATUS_LABELS, type VocabularyEntry, type VocabularyExample, type VocabularyStatus } from "./vocabularyStore";
import type { EcdictRecord } from "../../../server/ecdict";

type SortMode = "recent" | "oldest" | "az" | "za";
type FilterMode = "all" | VocabularyStatus;

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "recent", label: "最近收藏" },
  { value: "oldest", label: "最早收藏" },
  { value: "az", label: "单词 A–Z" },
  { value: "za", label: "单词 Z–A" },
];

const FILTER_OPTIONS: { value: FilterMode; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "pending", label: VOCABULARY_STATUS_LABELS.pending },
  { value: "learning", label: VOCABULARY_STATUS_LABELS.learning },
  { value: "mastered", label: VOCABULARY_STATUS_LABELS.mastered },
];

const STATUS_ORDER: VocabularyStatus[] = ["pending", "learning", "mastered"];

const IMPORT_PLACEHOLDER = '[{"word":"resilient","meaning":"有韧性的"}]\n也可以一行一个单词：\nserendipity\nwanderlust, 旅行癖';

function speak(word: string, lang: "en-GB" | "en-US") {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = lang;
  utterance.rate = 0.92;
  window.speechSynthesis.speak(utterance);
}

function playPronunciation(word: string, lang: "en-GB" | "en-US", audioUrl?: string) {
  if (audioUrl && typeof Audio !== "undefined") {
    const audio = new Audio(audioUrl);
    void audio.play().catch(() => speak(word, lang));
    return;
  }
  speak(word, lang);
}

function StatusPill({ status }: { status: VocabularyStatus }) {
  return <span className={`vocabulary-status vocabulary-status--${status}`}><span className="vocabulary-status-dot" />{VOCABULARY_STATUS_LABELS[status]}</span>;
}

/* Small toolbar menus: one button, one popup, Escape and outside clicks close them. */
function ToolbarMenu({ text, icon, value, options, onChange, active = false }: {
  text: string;
  icon: ReactNode;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="vocabulary-menu" ref={wrapRef}>
      <Button aria-expanded={open} aria-haspopup="menu" className={active ? "vocabulary-menu-button is-active" : "vocabulary-menu-button"} onClick={() => setOpen((current) => !current)} variant="secondary">
        {icon}
        <span>{text}</span>
        <ChevronDown size={14} />
      </Button>
      {open && (
        <div className="vocabulary-menu-popup" role="menu">
          {options.map((option) => (
            <button aria-checked={option.value === value} className={option.value === value ? "vocabulary-menu-item is-selected" : "vocabulary-menu-item"} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }} role="menuitemradio" type="button">
              <span>{option.label}</span>
              {option.value === value && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function VocabularyPage() {
  const navigate = useNavigate();
  const entries = useVocabulary();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sort, setSort] = useState<SortMode>("recent");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [masked, setMasked] = useState(false);
  const [revealed, setRevealed] = useState<string[]>([]);
  const [toast, setToast] = useState<{ text: string; undo?: { entry: VocabularyEntry; index: number } } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [britishAudioCache, setBritishAudioCache] = useState<Record<string, string>>({});
  const americanAudioCache = useRef<Record<string, HTMLAudioElement>>({});
  const toastTimer = useRef<number | null>(null);
  const [dictionaryDetails, setDictionaryDetails] = useState<Record<string, { collocations: string[]; collocationTranslations: Record<string, string>; examples: VocabularyExample[] }>>({});

  const showToast = useCallback((text: string, undo?: { entry: VocabularyEntry; index: number }) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(undo ? { text, undo } : { text });
    toastTimer.current = window.setTimeout(() => setToast(null), undo ? 5000 : 3200);
  }, []);

  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);

  useEffect(() => {
    if (!importOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setImportOpen(false); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [importOpen]);

  const visibleEntries = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return entries
      .filter((entry) => filter === "all" || entry.status === filter)
      .filter((entry) => !keyword || entry.word.toLowerCase().includes(keyword) || entry.meaning.toLowerCase().includes(keyword))
      .sort((a, b) => {
        if (sort === "az") return a.word.localeCompare(b.word, "en");
        if (sort === "za") return b.word.localeCompare(a.word, "en");
        if (sort === "oldest") return a.createdAt.localeCompare(b.createdAt);
        return b.createdAt.localeCompare(a.createdAt);
      });
  }, [entries, filter, search, sort]);

  const statusCounts: Record<FilterMode, number> = {
    all: entries.length,
    pending: entries.filter((entry) => entry.status === "pending").length,
    learning: entries.filter((entry) => entry.status === "learning").length,
    mastered: entries.filter((entry) => entry.status === "mastered").length,
  };
  const pendingCount = statusCounts.pending;
  const selected = visibleEntries.find((entry) => entry.id === selectedId) ?? visibleEntries[0] ?? null;
  const hasEntries = entries.length > 0;
  const importResult: VocabularyImportResult = useMemo(() => parseVocabularyImport(importText, entries.map((entry) => entry.word)), [entries, importText]);

  const isHidden = (entry: VocabularyEntry) => masked && !revealed.includes(entry.id);
  const reveal = (id: string) => setRevealed((current) => (current.includes(id) ? current : [...current, id]));

  function toggleMask() {
    setMasked((current) => !current);
    setRevealed([]);
  }

  function removeEntry(entry: VocabularyEntry) {
    const index = entries.findIndex((item) => item.id === entry.id);
    removeVocabulary(entry.id);
    if (selectedId === entry.id) setSelectedId(null);
    showToast(`已将 ${entry.word} 移出生词本`, { entry, index });
  }

  function undoRemove() {
    if (!toast?.undo) return;
    restoreVocabulary(toast.undo.entry, toast.undo.index);
    setSelectedId(toast.undo.entry.id);
    setToast(null);
  }

  function confirmImport() {
    if (!importResult.items.length) return;
    const result = addVocabularyEntries(importResult.items.map((item) => ({ source: IMPORT_SOURCE_LABEL, sourceType: "import" as const, status: "pending" as const, ...item })));
    setImportText("");
    setImportNotice(null);
    setImportOpen(false);
    setFilter("all");
    setSort("recent");
    setSearch("");
    showToast(`导入完成：新增 ${result.added} 个词${result.skipped ? `，跳过重复 ${result.skipped} 个` : ""}`);
  }

  async function onFileChosen(file?: File) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setImportNotice(`文件超过 ${MAX_IMPORT_BYTES / (1024 * 1024)} MB，请拆分后再导入`);
      return;
    }
    try {
      setImportText(await readImportFileText(file));
      setImportNotice(`已读取 ${file.name}`);
    } catch {
      setImportNotice("文件读取失败，请换一个文件试试");
    }
  }

  async function exportVocabulary() {
    try {
      const result = await saveVocabularyBackup(entries);
      if (result.status === "cancelled") return;
      showToast(result.status === "saved"
        ? `已导出 ${entries.length} 个词：${result.fileName}`
        : `已生成包含 ${entries.length} 个词的 JSON 备份，请保存下载文件`);
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "";
      showToast(detail ? `导出失败：${detail}` : "导出失败，请重试；原有生词未改动");
    }
  }

  function preloadAmericanAudio(word: string, audioUrl?: string) {
    const key = word.trim().toLowerCase();
    if (!audioUrl || americanAudioCache.current[key]) return;
    const audio = new Audio(audioUrl);
    audio.preload = "auto";
    audio.load();
    americanAudioCache.current[key] = audio;
  }

  function loadBritishAudio(word: string) {
    const key = word.trim().toLowerCase();
    if (britishAudioCache[key]) return;
    void fetchWordPronunciation(word, undefined, (pronunciation) => {
      if (pronunciation.british.audioUrl) setBritishAudioCache((current) => ({ ...current, [key]: pronunciation.british.audioUrl! }));
    }).then((pronunciation) => {
      if (pronunciation.british.audioUrl) setBritishAudioCache((current) => ({ ...current, [key]: pronunciation.british.audioUrl! }));
    });
  }

  function playWord(word: string, accent: "gb" | "us") {
    const key = word.trim().toLowerCase();
    const lang = accent === "gb" ? "en-GB" : "en-US";
    if (accent === "us") {
      const audio = americanAudioCache.current[key];
      if (!audio) {
        speak(word, lang);
        return;
      }
      audio.currentTime = 0;
      void audio.play().catch(() => speak(word, lang));
      return;
    }
    const audioUrl = britishAudioCache[key];
    if (audioUrl) {
      playPronunciation(word, lang, audioUrl);
      return;
    }
    speak(word, lang);
    loadBritishAudio(word);
  }

  useEffect(() => {
    if (typeof fetch !== "function" || !selected || selected.restoredFromBackup) return;
    const needsMeaning = selected.sourceType === "lookup" || selected.meaning === IMPORT_MISSING_MEANING;
    const needsDetails = selected.collocations.length === 0 || (selected.examples?.length ?? 0) === 0;
    if (!needsMeaning && !needsDetails) return;
    const controller = new AbortController();
    void fetch(`/api/local-dictionary?word=${encodeURIComponent(selected.word)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { entry?: EcdictRecord; oxford?: { collocations?: string[]; collocationTranslations?: Record<string, string>; examples?: VocabularyExample[] } } | null) => {
        const oxford = data?.oxford;
        if (controller.signal.aborted) return;
        if (data?.entry && needsMeaning) {
          const currentEntry = adaptEcdictRecord(data.entry);
          if (selected.meaning !== currentEntry.meaning || selected.definition !== currentEntry.definition || selected.partOfSpeech !== currentEntry.partOfSpeech) {
            saveVocabulary({
              word: selected.word,
              meaning: currentEntry.meaning,
              definition: currentEntry.definition,
              partOfSpeech: currentEntry.partOfSpeech,
              source: selected.source,
              sourceType: selected.sourceType,
            });
          }
        }
        if (oxford) {
          setDictionaryDetails((current) => ({
            ...current,
            [selected.word]: {
              collocations: oxford.collocations ?? [],
              collocationTranslations: oxford.collocationTranslations ?? {},
              examples: oxford.examples ?? [],
            },
          }));
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [selected?.word, selected?.restoredFromBackup]);

  useEffect(() => {
    if (typeof fetch !== "function" || entries.length === 0) return;
    const controller = new AbortController();
    entries.forEach((entry) => {
      void fetchWordPronunciation(entry.word, controller.signal, (pronunciation) => {
        if (controller.signal.aborted) return;
        preloadAmericanAudio(entry.word, pronunciation.american.audioUrl);
        if (pronunciation.british.audioUrl) setBritishAudioCache((current) => ({ ...current, [entry.word.trim().toLowerCase()]: pronunciation.british.audioUrl! }));
        const britishPhonetic = pronunciation.british.ipa || entry.britishPhonetic;
        const americanPhonetic = pronunciation.american.ipa || entry.americanPhonetic;
        if (!entry.restoredFromBackup && (britishPhonetic !== entry.britishPhonetic || americanPhonetic !== entry.americanPhonetic)) updateVocabularyPronunciation(entry.id, { phonetic: britishPhonetic, britishPhonetic, americanPhonetic });
      })
        .then((pronunciation) => {
          if (controller.signal.aborted) return;
          preloadAmericanAudio(entry.word, pronunciation.american.audioUrl);
          if (pronunciation.british.audioUrl) setBritishAudioCache((current) => ({ ...current, [entry.word.trim().toLowerCase()]: pronunciation.british.audioUrl! }));
          const britishPhonetic = pronunciation.british.ipa || entry.britishPhonetic;
          const americanPhonetic = pronunciation.american.ipa || entry.americanPhonetic;
          if (!entry.restoredFromBackup && (britishPhonetic !== entry.britishPhonetic || americanPhonetic !== entry.americanPhonetic)) {
            updateVocabularyPronunciation(entry.id, { phonetic: britishPhonetic, britishPhonetic, americanPhonetic });
          }
        })
        .catch(() => undefined);
    });
    return () => controller.abort();
  }, [entries]);

  const selectedOxford = selected && !selected.restoredFromBackup ? dictionaryDetails[selected.word] : undefined;
  const selectedCollocations = (selectedOxford?.collocations ?? selected?.collocations ?? []).slice(0, 4);
  const selectedCollocationTranslations = selectedOxford?.collocationTranslations ?? selected?.collocationTranslations ?? {};
  const selectedExamples = (selectedOxford?.examples ?? selected?.examples ?? []).filter((item) => item.translation);
  const selectedExamplesByPartOfSpeech = Array.from(selectedExamples.reduce((groups, item) => {
    const key = item.partOfSpeech || "其他";
    if (!groups.has(key)) groups.set(key, item);
    return groups;
  }, new Map<string, VocabularyExample>()).values());

  const importMessages: Partial<Record<VocabularyImportResult["format"], string>> = {
    "session-log": "这是语音聊天的记录文件，不是单词表。让插件导出单词列表，再导入到这里。",
    "unsupported-backup": "此备份的版本暂不支持，请升级 LanDict 后再导入。",
    "invalid-backup": "备份文件损坏或内容不完整，未导入任何生词，请重新导出。",
    "invalid-json": "JSON 文件不完整或格式有误，未导入任何生词，请检查文件或重新导出。",
  };
  const importSummary = importMessages[importResult.format]
    ?? (importResult.items.length || importResult.duplicateCount
      ? `识别到 ${importResult.rowCount} 行：新增 ${importResult.items.length} 个${importResult.duplicateCount ? `，重复跳过 ${importResult.duplicateCount} 个` : ""}${importResult.missingMeaningCount ? `，${importResult.missingMeaningCount} 个待补充释义` : ""}${importResult.format === "backup" ? "；将保留笔记、学习状态和收藏时间" : ""}`
      : importResult.format === "backup" ? "备份文件中没有生词。" : "还没有内容：粘贴 JSON 或单词列表，也可以选一个文件。");

  const detailContent = selected ? (
    <>
      <div className="vocabulary-detail-topline">
        <div className="vocabulary-detail-hero">
          <span className="vocabulary-eyebrow">词条详情</span>
          <h2>{selected.word}</h2>
        </div>
        <StatusPill status={selected.status} />
      </div>
      <div className="vocabulary-detail-pronunciations">
        <Button size="sm" variant="ghost" aria-label={`播放 ${selected.word} 英式发音`} onClick={() => void playWord(selected.word, "gb")} type="button"><Volume2 size={14} />英 {selected.britishPhonetic || "—"}</Button>
        <Button size="sm" variant="ghost" aria-label={`播放 ${selected.word} 美式发音`} onClick={() => void playWord(selected.word, "us")} type="button"><Volume2 size={14} />美 {selected.americanPhonetic || "—"}</Button>
      </div>
      <section className="vocabulary-section vocabulary-section--primary">
        <h3 className="vocabulary-section-title">中文释义</h3>
        {isHidden(selected)
          ? <Button className="vocabulary-reveal" onClick={() => reveal(selected.id)} type="button" variant="secondary"><Eye size={16} />点击显示中文释义</Button>
          : <p className="vocabulary-definition-text">{dedupeMeaningText(selected.meaning)}</p>}
      </section>
      <div className="vocabulary-detail-pair">
        <section className="vocabulary-section">
          <h3 className="vocabulary-section-title">词性</h3>
          {selected.partOfSpeech
            ? <div className="vocabulary-tags">{selected.partOfSpeech.split(" · ").map((part) => <span className="vocabulary-tag" key={part}>{part}</span>)}</div>
            : <p className="vocabulary-empty-text">暂无词性</p>}
        </section>
        <section className="vocabulary-section">
          <h3 className="vocabulary-section-title">来源</h3>
          <span className="vocabulary-source-label"><Bookmark size={14} />{selected.source}</span>
        </section>
      </div>
      <section className="vocabulary-section">
        <h3 className="vocabulary-section-title">常见搭配</h3>
        {selectedCollocations.length
          ? <div className="vocabulary-tags">{selectedCollocations.map((item) => <span className="vocabulary-tag" key={item}>{item}{selectedCollocationTranslations[item] && `（${selectedCollocationTranslations[item]}）`}</span>)}</div>
          : <p className="vocabulary-empty-text">暂无常见搭配</p>}
      </section>
      <section className="vocabulary-section">
        <h3 className="vocabulary-section-title">常见例句</h3>
        {selectedExamplesByPartOfSpeech.length
          ? <div className="vocabulary-examples">{selectedExamplesByPartOfSpeech.map((item) => (
            <div className="vocabulary-example" key={`${item.partOfSpeech}-${item.text}`}>
              <p className="vocabulary-example-en">{item.text}</p>
              {isHidden(selected)
                ? <Button className="vocabulary-reveal" onClick={() => reveal(selected.id)} size="sm" type="button" variant="secondary"><Eye size={15} />点击显示译文</Button>
                : <p className="vocabulary-example-cn">{item.translation}</p>}
            </div>
          ))}</div>
          : <p className="vocabulary-empty-text">暂无中文例句</p>}
      </section>
      <section className="vocabulary-study">
        <div className="vocabulary-study-copy">
          <h3 className="vocabulary-section-title">学习状态</h3>
          <span className="vocabulary-study-hint">收藏于 {new Date(selected.createdAt).toLocaleDateString("zh-CN")}</span>
        </div>
        <div className="vocabulary-study-actions">
          {STATUS_ORDER.map((status) => (
            <button aria-pressed={selected.status === status} className={`vocabulary-study-action vocabulary-study-action--${status}${selected.status === status ? " is-active" : ""}`} key={status} onClick={() => updateVocabulary(selected.id, { status })} type="button">
              <span className="vocabulary-status-dot" />{VOCABULARY_STATUS_LABELS[status]}
            </button>
          ))}
        </div>
      </section>
    </>
  ) : (
    <div className="vocabulary-detail-empty"><BookOpen size={24} /><p>选择一个单词查看详情</p></div>
  );

  return (
    <section className={hasEntries ? "vocabulary-page" : "vocabulary-page is-empty"}>
      <div className="vocabulary-content">
        {!hasEntries ? (
          <div className="vocabulary-empty"><BookOpen size={24} /><h2>生词本还是空的</h2><p>从查词页收藏单词，或在阅读器中点击生词，也可以直接导入一份单词表。</p><div className="vocabulary-empty-actions"><Link className={buttonVariants({ variant: "primary" })} to="/">去查询单词</Link><Link className={buttonVariants({ variant: "secondary" })} to="/reading">开始阅读</Link><Button onClick={() => setImportOpen(true)} variant="secondary"><Download size={16} />导入生词</Button></div></div>
        ) : (
          <>
            <header className="vocabulary-toolbar">
              <div className="vocabulary-toolbar-group">
                <SearchBox className="vocabulary-search" onSubmit={(event) => event.preventDefault()}>
                  <Input aria-label="搜索生词" onChange={(event) => setSearch(event.target.value)} placeholder="搜索生词或释义" value={search} />
                </SearchBox>
                <ToolbarMenu icon={<ArrowDownAZ size={16} />} onChange={(value) => setSort(value as SortMode)} options={SORT_OPTIONS} text={SORT_OPTIONS.find((option) => option.value === sort)?.label ?? "排序"} value={sort} />
              </div>
              <div className="vocabulary-toolbar-group vocabulary-toolbar-group--end">
                <Button onClick={() => { setImportNotice(null); setImportOpen(true); }} variant="secondary"><Download size={16} />导入</Button>
                <Button onClick={exportVocabulary} title={`导出全部 ${entries.length} 个生词为 JSON 备份`} variant="secondary"><Upload size={16} />导出</Button>
                <Button aria-pressed={masked} onClick={toggleMask} variant="secondary">{masked ? <Eye size={16} /> : <EyeOff size={16} />}{masked ? "显示全部释义" : "隐藏释义"}</Button>
                <Button onClick={() => navigate("/study")} variant="primary"><Graduate size={17} />开始背单词</Button>
              </div>
            </header>
            <div aria-label="按学习状态筛选" className="vocabulary-filters" role="group">
              {FILTER_OPTIONS.map((option) => (
                <button aria-label={`${option.label} ${statusCounts[option.value]}`} aria-pressed={filter === option.value} className="vocabulary-filter" key={option.value} onClick={() => setFilter(option.value)} type="button">
                  <span>{option.label}</span><small>{statusCounts[option.value]}</small>
                </button>
              ))}
            </div>
            <div className="vocabulary-workspace">
              <section className="vocabulary-list-panel" data-testid="vocabulary-master">
                <header className="vocabulary-list-head">
                  <div><span className="vocabulary-panel-title">我的生词</span><span className="vocabulary-panel-count">{visibleEntries.length} 个词</span></div>
                  <span className="vocabulary-panel-stat">{masked ? "遮挡模式 · 点击揭晓释义" : `待学习 ${pendingCount}`}</span>
                </header>
                <div className="vocabulary-list">
                  {visibleEntries.length ? visibleEntries.map((entry) => (
                    <article
                      className={selected?.id === entry.id ? "vocabulary-item is-selected" : "vocabulary-item"}
                      key={entry.id}
                      onClick={(event) => { if (!(event.target as HTMLElement).closest("button")) setSelectedId(entry.id); }}
                    >
                      <div className="vocabulary-item-main">
                        <div className="vocabulary-item-top">
                          <button aria-label={`查看 ${entry.word} 详情`} className="vocabulary-item-word" onClick={() => setSelectedId(entry.id)} type="button">{entry.word}</button>
                          <StatusPill status={entry.status} />
                        </div>
                        {isHidden(entry)
                          ? <button aria-label={`显示 ${entry.word} 的中文释义`} className="vocabulary-item-mask" onClick={() => reveal(entry.id)} type="button"><Eye size={13} />点击揭晓中文释义</button>
                          : <p className="vocabulary-item-meaning" title={dedupeMeaningText(entry.meaning)}>{dedupeMeaningText(entry.meaning)}</p>}
                      </div>
                      <IconButton className="vocabulary-item-remove" label={`移出 ${entry.word}`} onClick={() => removeEntry(entry)} type="button"><X /></IconButton>
                    </article>
                  )) : (
                    <div className="vocabulary-list-empty"><Search size={24} /><strong>没有匹配的单词</strong><span>换个关键词，或把筛选改回“全部状态”</span></div>
                  )}
                </div>
              </section>
              <Card className="vocabulary-detail" data-testid="vocabulary-detail" role="complementary" aria-label="单词详情">{detailContent}</Card>
            </div>
          </>
        )}
      </div>

      {importOpen && (
        <div className="vocabulary-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setImportOpen(false); }}>
          <div aria-labelledby="vocabulary-import-title" aria-modal="true" className="vocabulary-modal" role="dialog">
            <div className="vocabulary-modal-head">
              <h2 id="vocabulary-import-title">导入生词</h2>
              <IconButton label="关闭" onClick={() => setImportOpen(false)}><X /></IconButton>
            </div>
            <p className="vocabulary-modal-text">导入 LanDict 的 JSON 备份，可恢复生词、笔记、学习状态和收藏时间。也支持插件 JSON 或一行一个单词；重复词会跳过，不覆盖已有内容，缺少的释义会在打开词条时补充。</p>
            <label className="vocabulary-import-label" htmlFor="vocabulary-import-text">粘贴内容</label>
            <textarea
              className="vocabulary-import-text"
              id="vocabulary-import-text"
              onChange={(event) => { setImportText(event.target.value); setImportNotice(null); }}
              placeholder={IMPORT_PLACEHOLDER}
              spellCheck={false}
              value={importText}
            />
            <div className="vocabulary-import-or"><span>或者用文件</span></div>
            <label
              className="vocabulary-import-file"
              onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("is-dragging"); }}
              onDragLeave={(event) => event.currentTarget.classList.remove("is-dragging")}
              onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove("is-dragging"); void onFileChosen(event.dataTransfer?.files?.[0]); }}
            >
              <Download size={18} />
              <span className="vocabulary-import-file-copy">
                <strong>选择 .json / .txt / .csv 文件，或拖到这里</strong>
                <span>支持 LanDict 备份、插件 JSON 和 Excel 另存的 CSV</span>
              </span>
              <input accept=".json,.txt,.csv,application/json,text/plain,text/csv" aria-label="选择文件" onChange={(event) => { void onFileChosen(event.target.files?.[0]); event.target.value = ""; }} type="file" />
            </label>
            {importNotice && <p className="vocabulary-import-notice">{importNotice}</p>}
            <p className="vocabulary-import-summary" role="status">{importSummary}</p>
            <div className="vocabulary-modal-footer">
              <span>只在本机处理，不会上传。</span>
              <Button disabled={!importResult.items.length} onClick={confirmImport} variant="primary">导入 {importResult.items.length} 个词</Button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div aria-live="polite" className="vocabulary-toast" role="status">
          <Check size={17} />
          <span>{toast.text}</span>
          {toast.undo && <button className="vocabulary-toast-undo" onClick={undoRemove} type="button">撤销</button>}
        </div>
      )}
    </section>
  );
}

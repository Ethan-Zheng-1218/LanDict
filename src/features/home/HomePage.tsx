import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { PageHeader } from "@/components/ui/page-header";
import { SearchBox } from "@/components/ui/search-box";
import { ChevronRight, History, Trash2 } from "@/components/ui/icon";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { AssistedWordInput } from "../translation/AssistedWordInput";
import {
  addHistory,
  clearHistory,
  HISTORY_CHANGED_EVENT,
  listHistory,
  updateHistoryPreview,
  type HistoryEntry,
} from "../history/historyStore";
import { classifyQuery, resolveQuery } from "../translation/translationService";

export function HomePage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>(() => listHistory());
  const [historyPreviews, setHistoryPreviews] = useState<Record<string, string>>(() =>
    Object.fromEntries(listHistory().filter((entry) => entry.preview).map((entry) => [entry.id, entry.preview!])),
  );
  const pageRef = useRef<HTMLElement>(null);
  const historyAreaRef = useRef<HTMLDivElement>(null);
  const rowHeightRef = useRef(42);
  const [searchGap, setSearchGap] = useState(48);
  const [visibleCount, setVisibleCount] = useState<number | null>(null);
  const recentEntries = history.slice(0, visibleCount ?? history.length);
  const hasMoreHistory = recentEntries.length < history.length;

  useLayoutEffect(() => {
    const page = pageRef.current;
    const area = historyAreaRef.current;
    if (!page || !area) return;
    const measure = () => {
      const intro = page.querySelector<HTMLElement>(".home-intro");
      const searchBox = page.querySelector<HTMLElement>(".home-query");
      const readingNav = document.querySelector<HTMLElement>('.app-sidebar a[href="/reading"]');
      if (intro && searchBox && readingNav) {
        const navBounds = readingNav.getBoundingClientRect();
        const gap = navBounds.top + navBounds.height / 2 - intro.getBoundingClientRect().bottom - searchBox.getBoundingClientRect().height / 2;
        setSearchGap(Math.max(24, gap));
      }
      const card = area.querySelector<HTMLElement>(".home-history");
      const list = area.querySelector<HTMLElement>(".home-history-list");
      if (!card || !list || !area.getBoundingClientRect().height) return;
      const firstRow = list.querySelector("li");
      const rowHeight = firstRow?.getBoundingClientRect().height;
      if (rowHeight) rowHeightRef.current = rowHeight;
      const style = getComputedStyle(card);
      const bottomSpace = (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.borderBottomWidth) || 0);
      const available = area.getBoundingClientRect().height - (list.getBoundingClientRect().top - card.getBoundingClientRect().top) - bottomSpace;
      const allFit = history.length * rowHeightRef.current <= available;
      // Reserve one 32px line for the overflow marker, and render only complete rows.
      setVisibleCount(allFit ? history.length : Math.max(0, Math.floor((available - 32) / rowHeightRef.current)));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(page);
    observer?.observe(area);
    const firstRow = area.querySelector("li");
    if (firstRow) observer?.observe(firstRow);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [history.length, notice, searchGap]);

  useEffect(() => {
    const refresh = () => {
      const next = listHistory();
      setHistory(next);
      setHistoryPreviews(Object.fromEntries(next.filter((entry) => entry.preview).map((entry) => [entry.id, entry.preview!])));
    };
    window.addEventListener(HISTORY_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(HISTORY_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useEffect(() => {
    const pendingWords = history.filter((entry) => entry.kind === "word" && !entry.preview && !historyPreviews[entry.id]);
    if (!pendingWords.length) return;
    const controller = new AbortController();
    pendingWords.forEach((entry) => {
      void resolveQuery(entry.query, controller.signal).then((result) => {
        if (controller.signal.aborted || result.kind !== "word" || result.status !== "success" || !result.meaning) return;
        setHistoryPreviews((current) => ({ ...current, [entry.id]: result.meaning }));
        updateHistoryPreview(entry.query, result.meaning);
      }).catch(() => { /* Leaving home cancels unfinished preview requests. */ });
    });
    return () => controller.abort();
  }, [history, historyPreviews]);

  function openQuery(value: string) {
    navigate(`/query?q=${encodeURIComponent(value)}`);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (!value) {
      setNotice("请输入需要查询的内容。");
      return;
    }
    setNotice("");
    addHistory({ query: value, kind: classifyQuery(value), source: "LanDict 查询" });
    openQuery(value);
  }

  return (
    <section className="home-page" ref={pageRef}>
      <PageHeader className="home-intro" title="从一个单词，开始今天的学习" />
      <SearchBox className="home-query" style={{ marginTop: searchGap }} onSubmit={handleSubmit}>
        <AssistedWordInput as="input" label="输入需要查询的内容" onChange={setQuery} placeholder="输入你要查询的内容" value={query} />
        <Button type="submit">查询</Button>
      </SearchBox>
      {notice && <p className="lookup-notice" role="status">{notice}</p>}

      <div className="home-history-area" ref={historyAreaRef}>
      <Card className="home-history" role="region" aria-labelledby="home-history-title">
        <CardHeader className="home-history-header">
          <h2 id="home-history-title">查询记录</h2>
          <div className="home-history-actions">
            <IconButton label="查看历史记录" nativeButton={false} render={<Link to="/records" />}><History /></IconButton>
            <IconButton label="清除记录" disabled={history.length === 0} onClick={clearHistory} type="button" variant="destructive"><Trash2 /></IconButton>
          </div>
        </CardHeader>

        <CardContent>
        {history.length > 0 ? (
          <ul className="home-history-list">
            {recentEntries.map((entry) => (
              <li key={entry.id}>
                <button aria-label={`重新查询：${entry.query}`} onClick={() => openQuery(entry.query)} type="button">
                  <span className="home-history-copy">
                    <span className="home-history-query" title={entry.query}>{entry.query}</span>
                    <span className="home-history-preview" title={historyPreviews[entry.id] ?? entry.preview ?? "暂无摘要"}>
                      {historyPreviews[entry.id] ?? entry.preview ?? "暂无摘要"}
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" size={16} />
                </button>
              </li>
            ))}
          </ul>
        ) : <div className="home-history-empty">暂无查询记录</div>}
        {hasMoreHistory && <div className="home-history-more" aria-label="还有更多查询记录"><span aria-hidden="true">···</span></div>}
        </CardContent>
      </Card>
      </div>

      <footer className="home-quote" aria-label="LanDict 名言">
        <div className="home-quote-copy">
          <p>“The limits of my language mean the limits of my world.”</p>
          <p>语言的边界，就是我世界的边界。—— 路德维希·维特根斯坦</p>
        </div>
      </footer>
    </section>
  );
}

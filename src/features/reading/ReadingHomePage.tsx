import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type { FeedItem } from "./feedItem";
import { extractArticleDocument } from "./articleExtraction";
import { FEED_CHANGED_EVENT, listFeedItems, refreshReadingFeed, refreshReadingFeedOnce } from "./feedRepository";
import { getArticleDocument, needsArticleReextraction } from "./articleRepository";
import { READING_ARTICLE_ID, READING_CHANGED_EVENT, listReadingRecords, type ReadingRecord } from "./readingStore";
import { formatSourceKicker } from "./sourceLabel";
import { getResumeScrollTop } from "./readingResume";

type ReadingView = "recommend" | "news" | "articles" | "favorites" | "history";

function ProgressBar({ value, mini = false }: { value: number; mini?: boolean }) {
  return <div className={mini ? "reading-mini-progress" : "reading-progress"}><i style={{ width: `${value}%` }} /></div>;
}

export function ReadingHomePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const pageRef = useRef<HTMLElement>(null);
  const view = readReadingView(location.search);
  const [feedItems, setFeedItems] = useState<FeedItem[]>(() => listFeedItems());
  const [records, setRecords] = useState<ReadingRecord[]>(() => listReadingRecords());
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const refreshInProgress = useRef(false);
  const noticeTimer = useRef<number | undefined>(undefined);
  const record = records.find((item) => !item.completed && (
    item.articleId === READING_ARTICLE_ID || feedItems.some((feed) => feed.id === item.articleId) || getArticleDocument(item.articleId)
  ));
  const progress = Math.min(100, Math.max(0, Math.round(record?.progress ?? 0)));
  const continueDescription = `上次阅读进度：${progress}%`;
  const favoriteItems = useMemo(() => feedItems.filter((item) => records.find((recordItem) => recordItem.articleId === item.id)?.favorite), [feedItems, records]);
  const historyItems = useMemo(() => records.map((item) => ({ item, feed: feedItems.find((feedItem) => feedItem.id === item.articleId) })), [feedItems, records]);
  const newsItems = useMemo(() => feedItems.filter((item) => (item.contentType ?? "news") === "news"), [feedItems]);
  const articleItems = useMemo(() => feedItems.filter((item) => item.contentType === "article"), [feedItems]);

  useEffect(() => {
    if (pageRef.current) pageRef.current.scrollTop = getResumeScrollTop(location.state) ?? 0;
  }, [location.key]);

  useEffect(() => {
    const refresh = () => { setFeedItems(listFeedItems()); setRecords(listReadingRecords()); };
    window.addEventListener(FEED_CHANGED_EVENT, refresh);
    window.addEventListener(READING_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    void refreshReadingFeedOnce();
    return () => { window.removeEventListener(FEED_CHANGED_EVENT, refresh); window.removeEventListener(READING_CHANGED_EVENT, refresh); window.removeEventListener("storage", refresh); };
  }, []);

  function toast(message: string) {
    window.clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 4000);
  }

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  async function refreshFeed() {
    if (refreshInProgress.current) return;
    refreshInProgress.current = true;
    setRefreshing(true);
    window.clearTimeout(noticeTimer.current);
    setNotice("");
    try {
      const result = await refreshReadingFeed();
      setFeedItems(result.items);
      toast(result.partial ? "已刷新可用内容，部分来源暂时不可用，请稍后重试" : "刷新成功，已获取最新新闻和文章");
    } catch {
      toast("刷新失败，已保留原有内容，请检查网络后重试");
    } finally {
      refreshInProgress.current = false;
      setRefreshing(false);
    }
  }

  function setView(next: ReadingView) {
    navigate({ pathname: "/reading", search: readingViewSearch(next) }, { replace: true });
  }

  async function openArticle(item: FeedItem) {
    try {
      const cached = getArticleDocument(item.id);
      let document = cached;
      if (!document || needsArticleReextraction(document)) document = await extractArticleDocument(item);
      navigate(`/reading/article?id=${encodeURIComponent(document.id)}`, {
        state: { returnTo: { pathname: "/reading", search: readingViewSearch(view) } },
      });
    } catch {
      toast("文章暂时无法打开");
    }
  }

  const continueArticle = feedItems.find((item) => item.id === record?.articleId);
  const continueDocument = record ? getArticleDocument(record.articleId) : undefined;
  const continueImage = continueArticle?.imageUrl ?? continueDocument?.imageUrl;
  return <section className="reading-home-page" aria-label="阅读" ref={pageRef}>
    <div className="reading-content">
      <div className="reading-page-actions"><div className="reading-page-actions-left" role="group" aria-label="阅读视图">
        <Button size="sm" variant="ghost" aria-pressed={view === "recommend"} className={`reading-primary-tab ${view === "recommend" ? "active-tab" : ""}`} onClick={() => setView("recommend")} type="button">推荐</Button>
        <Button size="sm" variant="ghost" aria-pressed={view === "news"} className={`reading-primary-tab ${view === "news" ? "active-tab" : ""}`} onClick={() => setView("news")} type="button">新闻</Button>
        <Button size="sm" variant="ghost" aria-pressed={view === "articles"} className={`reading-primary-tab ${view === "articles" ? "active-tab" : ""}`} onClick={() => setView("articles")} type="button">文章</Button>
      </div><div className="reading-page-actions-right">
        <Button size="sm" variant="secondary" className="reading-refresh-button" aria-label="刷新" loading={refreshing} onClick={() => void refreshFeed()} type="button"><span aria-hidden={refreshing}>刷新</span></Button>
        <Button size="sm" variant="secondary" aria-pressed={view === "favorites"} className={view === "favorites" ? "active-tab" : undefined} onClick={() => setView("favorites")} type="button">收藏</Button>
        <Button size="sm" variant="secondary" aria-pressed={view === "history"} className={view === "history" ? "active-tab" : undefined} onClick={() => setView("history")} type="button">阅读历史</Button>
      </div></div>
      {view === "recommend" && <>
        <section className="reading-section reading-section-first"><div className="reading-section-head"><h2>今日推荐</h2><Button size="sm" variant="link" className="reading-more" onClick={() => setView("news")} type="button">浏览更多 →</Button></div><FeedGrid items={[...newsItems.slice(0, 3), ...articleItems.slice(0, 3)]} onOpen={openArticle} /></section>
        {record && <section className="reading-section reading-section-first">
          <div className="reading-section-head"><h2>继续阅读</h2></div>
          <Card className="reading-continue-card">
            <div className="reading-continue-thumb">{continueImage && <img alt={record.title} src={continueImage} />}</div>
            <div><div className="reading-continue-title">{record.title}</div><div className="reading-continue-desc">{continueDescription}</div><div className="reading-progress-row"><ProgressBar value={progress} /><span className="reading-progress-text">{progress}%</span></div></div>
            <Button size="sm" variant="primary" className="reading-continue-btn" onClick={() => continueArticle ? void openArticle(continueArticle) : navigate(`/reading/article?id=${encodeURIComponent(record.articleId)}`, { state: { returnTo: { pathname: "/reading", search: readingViewSearch(view) } } })} type="button">继续阅读</Button>
          </Card>
        </section>}
      </>}
      {view === "news" && <section className="reading-section reading-section-first"><div className="reading-section-head"><h2>新闻</h2><span className="reading-meta">最近 5 天</span></div><FeedGrid items={newsItems} onOpen={openArticle} emptyMessage="暂时没有可用的新闻，请稍后重试。" /></section>}
      {view === "articles" && <section className="reading-section reading-section-first"><div className="reading-section-head"><h2>文章</h2></div><FeedGrid items={articleItems} onOpen={openArticle} emptyMessage="暂时没有可用的文章，请稍后重试。" /></section>}
      {view === "favorites" && <section className="reading-section reading-section-first"><div className="reading-section-head"><h2>收藏文章</h2><span className="reading-meta">{favoriteItems.length} 篇</span></div><FeedGrid items={favoriteItems} onOpen={openArticle} emptyMessage="还没有收藏文章。" /></section>}
      {view === "history" && <section className="reading-section reading-section-first"><div className="reading-section-head"><h2>阅读历史</h2><span className="reading-meta">{historyItems.length} 篇</span></div><RecentList items={historyItems} onOpen={openArticle} onBundled={() => navigate(`/reading/article?id=${READING_ARTICLE_ID}`)} emptyMessage="还没有阅读记录。" /></section>}
    </div><div role="status" aria-live="polite" className={`reading-toast ${notice ? "show" : ""}`}>{notice}</div>
  </section>;
}

function FeedGrid({ items, onOpen, emptyMessage = "正在等待新闻 Feed……" }: { items: FeedItem[]; onOpen: (item: FeedItem) => void; emptyMessage?: string }) {
  if (!items.length) return <div className="reading-vocab-empty">{emptyMessage}</div>;
  return <div className="reading-feed-grid">{items.map((item) => { const imageUrl = item.imageUrl ?? getCachedCover(item); return <Card role="article" className="reading-feed-card" key={item.id}><button className="reading-card" onClick={() => onOpen(item)} type="button"><span className="reading-thumb">{imageUrl && <img alt={item.title} src={imageUrl} />}</span><span className="reading-card-body"><span className="reading-kicker">{formatSourceKicker(item.source, item.category)}</span><span className="reading-card-title">{item.title}</span><span className="reading-meta"><span>{formatDate(item.publishedAt)}</span></span></span></button></Card>; })}</div>;
}

function getCachedCover(item: FeedItem): string | undefined {
  const document = getArticleDocument(item.localArticleId ?? item.id);
  return document?.imageUrl ?? document?.blocks.find((block) => block.type === "image")?.src;
}

function readReadingView(search: string): ReadingView {
  const params = new URLSearchParams(search);
  const value = params.get("view");
  if (value === "channels") return params.get("channel") === "articles" ? "articles" : "news";
  if (value === "more") return "news";
  return value === "news" || value === "articles" || value === "favorites" || value === "history" ? value : "recommend";
}

function readingViewSearch(view: ReadingView): string {
  if (view === "recommend") return "";
  const params = new URLSearchParams({ view });
  return `?${params.toString()}`;
}

function RecentList({ items, onOpen, onBundled, emptyMessage = "还没有阅读记录。" }: { items: Array<{ item: ReadingRecord; feed?: FeedItem }>; onOpen: (item: FeedItem) => void; onBundled: () => void; emptyMessage?: string }) {
  if (!items.length) return <div className="reading-vocab-empty">{emptyMessage}</div>;
  return <Card className="reading-recent-list">{items.map(({ item, feed }) => <div className="reading-recent-item" key={item.articleId}><div><div className="reading-recent-title">{feed?.title ?? item.title}</div><div className="reading-recent-meta"><span>{formatDate(item.lastReadAt)}</span><span>·</span><span>{item.completed ? "已读完" : `阅读 ${item.progress}%`}</span>{item.favorite && <span>· ★ 已收藏</span>}</div></div><div className="reading-recent-actions"><ProgressBar mini value={item.progress} /><Button size="sm" variant="secondary" className="reading-small-btn" onClick={() => feed ? onOpen(feed) : onBundled()} type="button">{item.completed ? "再次阅读" : "继续阅读"}</Button></div></div>)}</Card>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

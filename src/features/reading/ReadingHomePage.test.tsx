import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Link, MemoryRouter, useLocation } from "react-router-dom";

import { updateReadingProgress } from "./readingStore";
import { ReadingHomePage } from "./ReadingHomePage";
import { ReadingArticlePage } from "./ReadingArticlePage";
import { resetFeedRefreshForTests, saveFeedItems } from "./feedRepository";
import * as newsSources from "./newsSources";
import { ARTICLE_EXTRACTOR_VERSION, saveArticleDocument } from "./articleRepository";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function ReadingRouteProbe() {
  const location = useLocation();
  return location.pathname === "/reading/article" ? <ReadingArticlePage /> : <ReadingHomePage />;
}

describe("ReadingHomePage", () => {
  it("restores the sidebar resume position on the selected list", () => {
    render(<MemoryRouter initialEntries={[{ pathname: "/reading", search: "?view=news", state: { readingScrollTop: 317 } }]}><ReadingHomePage /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "新闻" })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".reading-home-page")?.scrollTop).toBe(317);
  });
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
    resetFeedRefreshForTests();
    window.sessionStorage.setItem("landict.reading.feed-refreshed", "1");
  });

  it("refreshes from the button before favorites, shows progress and updates the list", async () => {
    window.sessionStorage.setItem("landict.reading.feed-refreshed", "1");
    let finish!: (value: Awaited<ReturnType<typeof newsSources.fetchAllSourceFeeds>>) => void;
    const fetchFeeds = vi.spyOn(newsSources, "fetchAllSourceFeeds").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<MemoryRouter><ReadingHomePage /></MemoryRouter>);
    const button = screen.getByRole("button", { name: "刷新" });
    expect(button.nextElementSibling).toBe(screen.getByRole("button", { name: "收藏" }));
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(within(button).getByText("刷新")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(button);
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    finish({ items: [{ id: "new-story", source: "bbc", title: "Freshly fetched news", summary: "", originalUrl: "https://www.bbc.com/news/articles/fresh", publishedAt: new Date(Date.now() - 60_000).toISOString(), category: "World", downloaded: false }], successfulSources: Object.keys(newsSources.SOURCE_ENDPOINTS) as newsSources.ExternalArticleSource[] });
    await waitFor(() => expect(screen.getByText("Freshly fetched news")).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("刷新成功");
    expect(button).toBeEnabled();
    expect(within(button).getByText("刷新")).toHaveAttribute("aria-hidden", "false");
    expect(fetchFeeds).toHaveBeenCalledTimes(1);
  });

  it("shows failure while keeping cached content and can refresh again", async () => {
    window.sessionStorage.setItem("landict.reading.feed-refreshed", "1");
    saveFeedItems([{ id: "cached", source: "bbc", title: "Cached news", summary: "", originalUrl: "https://www.bbc.com/news/articles/cached", publishedAt: new Date().toISOString(), category: "World", downloaded: false }]);
    vi.spyOn(newsSources, "fetchAllSourceFeeds").mockResolvedValueOnce({ items: [], successfulSources: [] }).mockResolvedValueOnce({ items: [], successfulSources: Object.keys(newsSources.SOURCE_ENDPOINTS) as newsSources.ExternalArticleSource[] });
    render(<MemoryRouter><ReadingHomePage /></MemoryRouter>);
    const button = screen.getByRole("button", { name: "刷新" });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("刷新失败"));
    expect(screen.getByText("Cached news")).toBeInTheDocument();
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("刷新成功"));
  });

  it("reports partial success when some sources are unavailable", async () => {
    window.sessionStorage.setItem("landict.reading.feed-refreshed", "1");
    vi.spyOn(newsSources, "fetchAllSourceFeeds").mockResolvedValue({ items: [], successfulSources: ["bbc"] });
    render(<MemoryRouter><ReadingHomePage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("部分来源暂时不可用"));
    expect(screen.getByRole("status")).not.toHaveTextContent("刷新成功");
  });

  it("shows the BBC source once on a feed card even when the feed has no section", async () => {
    saveFeedItems([{ id: "bbc-no-section", source: "bbc", title: "Top news story without a section", summary: "Summary", originalUrl: "https://www.bbc.co.uk/news/articles/c6jdm5n1vy7go", publishedAt: "2026-10-04T08:00:00.000Z", category: "BBC News", downloaded: false }]);
    render(<MemoryRouter initialEntries={["/reading"]}><ReadingHomePage /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "浏览更多 →" }));

    await waitFor(() => expect(screen.getByText("Top news story without a section")).toBeInTheDocument());
    const kickers = screen.getAllByText(/^BBC News/);
    expect(kickers).toHaveLength(1);
    expect(kickers[0]).toHaveTextContent("BBC News");
    expect(screen.queryByText(/BBC News · BBC News/)).not.toBeInTheDocument();
    expect(screen.queryByText("BBC")).not.toBeInTheDocument();
  });

  it("keeps a real section next to the source name on a feed card", async () => {
    saveFeedItems([{ id: "bbc-section", source: "bbc", title: "Story with a section", summary: "Summary", originalUrl: "https://www.bbc.com/news/articles/section", publishedAt: "2026-10-04T08:00:00.000Z", category: "World", downloaded: false }]);
    render(<MemoryRouter initialEntries={["/reading"]}><ReadingHomePage /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "浏览更多 →" }));

    await waitFor(() => expect(screen.getByText("BBC News · World")).toBeInTheDocument());
  });

  it("shows the saved reading progress", () => {
    updateReadingProgress("global-push-clean-energy", 42, "Global Push for Clean Energy Gains Momentum");

    render(<MemoryRouter><ReadingHomePage /></MemoryRouter>);

    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText("上次阅读进度：42%")).toBeInTheDocument();
  });

  it("opens the article page from continue reading", async () => {
    updateReadingProgress("global-push-clean-energy", 42, "Global Push for Clean Energy Gains Momentum");
    render(<MemoryRouter initialEntries={["/reading"]}><ReadingHomePage /><LocationProbe /></MemoryRouter>);

    fireEvent.click(screen.getAllByRole("button", { name: "继续阅读" })[0]);

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/reading/article"));
  });

  it("shows more BBC feed items without changing the reading route", async () => {
    saveFeedItems([{ id: "bbc-more", source: "bbc", title: "Real BBC story", summary: "Summary", originalUrl: "https://www.bbc.com/news/articles/more", publishedAt: "2026-10-04T08:00:00.000Z", category: "World", downloaded: false }]);
    render(<MemoryRouter initialEntries={["/reading"]}><ReadingHomePage /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "浏览更多 →" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "新闻" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "浏览更多" })).not.toBeInTheDocument();
    expect(screen.getByText("Real BBC story")).toBeInTheDocument();
    expect(screen.getByText("BBC News · World")).toBeInTheDocument();
  });

  it("provides recommendation, news and articles as peer views", async () => {
    saveFeedItems([
      ...Array.from({ length: 3 }, (_, index) => ({ id: `bbc-news-${index}`, source: "bbc" as const, title: `News story ${index}`, summary: "Summary", originalUrl: `https://www.bbc.com/news/articles/news-${index}`, publishedAt: `2026-10-06T0${index}:00:00.000Z`, category: "World", downloaded: false })),
      ...Array.from({ length: 3 }, (_, index) => ({ id: `aeon-article-${index}`, source: "aeon" as const, title: `Article story ${index}`, summary: "Summary", originalUrl: `https://aeon.co/essays/article-${index}`, publishedAt: `2026-10-06T1${index}:00:00.000Z`, category: "Ideas", contentType: "article" as const, downloaded: false })),
    ]);
    render(<MemoryRouter initialEntries={["/reading"]}><ReadingHomePage /></MemoryRouter>);

    expect(screen.getAllByRole("button", { name: /News story|Article story/ })).toHaveLength(6);
    const views = screen.getByRole("group", { name: "阅读视图" });
    expect(within(views).getAllByRole("button")).toHaveLength(3);
    expect(within(views).getByRole("button", { name: "推荐" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "频道" })).not.toBeInTheDocument();
    expect(screen.queryByText("内容类型")).not.toBeInTheDocument();
    fireEvent.click(within(views).getByRole("button", { name: "文章" }));
    expect(within(views).getByRole("button", { name: "文章" })).toHaveAttribute("aria-pressed", "true");
    expect(within(views).getByRole("button", { name: "新闻" })).toHaveAttribute("aria-pressed", "false");

    await waitFor(() => expect(screen.getByText("Article story 0")).toBeInTheDocument());
    expect(screen.queryByText("News story 0")).not.toBeInTheDocument();
    fireEvent.click(within(views).getByRole("button", { name: "新闻" }));
    expect(screen.getByText("News story 0")).toBeInTheDocument();
    expect(screen.queryByText("Article story 0")).not.toBeInTheDocument();
  });

  it.each(["推荐", "新闻", "文章"])("returns to %s after opening an article", async (view) => {
    saveFeedItems([{ id: "aeon-return", source: "aeon", title: "Channel article", summary: "Summary", originalUrl: "https://aeon.co/essays/channel-return", publishedAt: "2026-10-06T10:00:00.000Z", category: "Ideas", contentType: view === "新闻" ? "news" : "article", downloaded: false }]);
    saveArticleDocument({ id: "aeon-return", source: "aeon", title: "Channel article", summary: "Summary", originalUrl: "https://aeon.co/essays/channel-return", publishedAt: "2026-10-06T10:00:00.000Z", category: "Ideas", contentType: "article", downloaded: true, extractorVersion: ARTICLE_EXTRACTOR_VERSION, blocks: [{ id: "paragraph-1", type: "paragraph", text: "Article body." }] });
    render(<MemoryRouter initialEntries={["/reading"]}><ReadingRouteProbe /><LocationProbe /><Link to="/reading">重新进入阅读</Link></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: view }));
    fireEvent.click(screen.getByRole("button", { name: /Channel article/ }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/reading/article"));
    fireEvent.click(screen.getByRole("button", { name: "返回阅读列表" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/reading"));
    expect(screen.getByRole("button", { name: view })).toHaveClass("active-tab");
    fireEvent.click(screen.getByRole("link", { name: "重新进入阅读" }));
    expect(screen.getByRole("button", { name: "推荐" })).toHaveAttribute("aria-pressed", "true");
  });

  it("does not provide offline download actions on feed cards", () => {
    saveFeedItems([{ id: "bbc-download", source: "bbc", title: "Downloadable BBC story", summary: "Summary", originalUrl: "https://www.bbc.com/news/articles/download", publishedAt: "2026-10-04T08:00:00.000Z", category: "World", downloaded: false }]);
    render(<MemoryRouter initialEntries={["/reading"]}><ReadingHomePage /></MemoryRouter>);

    expect(screen.queryByRole("button", { name: "下载离线" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "已下载" })).not.toBeInTheDocument();
  });
});

# BBC Reading Data Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 接入 BBC News Feed 和正文解析，将真实/下载文章通过统一 `ArticleDocument` 接入现有 LanDict 阅读首页和 ReadingPage。

**Architecture:** BBC Source 负责 RSS/HTML 获取，BBC Parser 负责白名单转换，FeedRepository 和 ArticleRepository 负责本地缓存/下载。ReadingHomePage 只读取 Feed 与 ReadingRecord，ReadingArticlePage 只读取 ArticleDocument，不依赖 BBC HTML 结构。

**Tech Stack:** React 19, TypeScript, React Router, Vitest, DOMParser, localStorage。

**Spec:** `docs/superpowers/specs/2026-10-04-bbc-reading-data-design.md`

## Global Constraints

- 当前阶段只支持 BBC。
- Feed 只保留最近 5 天新闻；每次应用运行只自动刷新一次；网络失败继续显示旧缓存。
- 下载保存转换完成的 `ArticleDocument`，不受 Feed 清理影响，离线正文必须可读。
- 保持当前阅读首页、ReadingPage 和阅读交互，不创建第二套文章系统。
- 每次修改完成必须创建对应 Git commit。

## Review Focus

- RSS 中缺少可选字段或单条 XML 损坏时，其他条目仍应展示；由 Feed parser tests 固定。
- 发布时间带时区、未来时间或超过 5 天时，过滤结果必须稳定；由 date filter tests 固定。
- BBC HTML 缺少主正文或包含无关导航时，Parser 应返回安全错误/白名单 blocks；由 parser tests 固定。
- Feed 刷新失败时必须保留缓存，下载文章不得被清理；由 repository tests 固定。
- ReadingPage 切换 articleId 后必须恢复对应 progress/annotations；由 page tests 固定。

### Task 1: ArticleDocument model and repository persistence

**Files:**
- Create: `src/features/reading/articleDocument.ts`
- Create: `src/features/reading/articleRepository.ts`
- Test: `src/features/reading/articleRepository.test.ts`

**Interfaces:**
- Produces `ArticleDocument`, `ArticleBlock`, `getArticleDocument(id)`, `saveArticleDocument(document)`, `listDownloadedArticles()`, `clearExpiredFeedArticles(ids)`.

- [ ] Write failing tests for typed blocks, save/read roundtrip, downloaded article retention, and malformed data rejection.
- [ ] Run `pnpm exec vitest run src/features/reading/articleRepository.test.ts` and verify expected failures.
- [ ] Implement versioned localStorage repository using `landict.reading.articles.v1`; downloaded documents are retained independently from Feed cleanup.
- [ ] Run the repository test and verify it passes.
- [ ] Commit `feat: add local article document repository`.

### Task 2: BBC RSS source and parser

**Files:**
- Create: `src/features/reading/bbcSource.ts`
- Create: `src/features/reading/bbcSource.test.ts`
- Create: `src/features/reading/fixtures/bbc-feed.xml`

**Interfaces:**
- Produces `BbcFeedItem`, `fetchBbcFeed(fetcher, now)`, and `fetchBbcArticle(url, fetcher)`.

- [ ] Write failing tests for 5-day filtering, missing-field tolerance, per-item failure isolation, and one request per source call.
- [ ] Run the source tests and verify expected failures.
- [ ] Implement RSS XML parsing via DOMParser, canonical BBC metadata mapping, safe date/category/image extraction, and injectable fetcher.
- [ ] Add article HTML fetch path that returns raw HTML to the Parser boundary without exposing it to ReadingPage.
- [ ] Run source tests and verify they pass.
- [ ] Commit `feat: add BBC feed source`.

### Task 3: BBC article parser

**Files:**
- Create: `src/features/reading/bbcParser.ts`
- Create: `src/features/reading/bbcParser.test.ts`
- Create: `src/features/reading/fixtures/bbc-article.html`

**Interfaces:**
- Produces `parseBbcArticle(html, feedItem) -> ArticleDocument`.

- [ ] Write failing tests for title/date/source, paragraph/heading/image/caption/quote/list blocks, removal of navigation/ad/footer nodes, and missing-main error.
- [ ] Run parser tests and verify expected failures.
- [ ] Implement DOMParser-based whitelist extraction with stable block ids and no raw HTML rendering.
- [ ] Run parser tests and verify they pass.
- [ ] Commit `feat: parse BBC articles into reading documents`.

### Task 4: Feed repository and one-refresh orchestration

**Files:**
- Create: `src/features/reading/feedRepository.ts`
- Test: `src/features/reading/feedRepository.test.ts`

**Interfaces:**
- Produces `listFeedItems()`, `saveFeedItems(items)`, `refreshBbcFeedOnce(options)`, `FEED_CHANGED_EVENT`.

- [ ] Write failing tests for cache-first reads, one refresh per runtime, failed refresh fallback, and removal of expired non-downloaded entries only.
- [ ] Run repository tests and verify expected failures.
- [ ] Implement local cache plus module/session refresh guard and background refresh result handling.
- [ ] Run repository tests and verify they pass.
- [ ] Commit `feat: add BBC feed cache repository`.

### Task 5: ReadingPage ArticleDocument rendering

**Files:**
- Modify: `src/features/reading/readingContent.ts`
- Modify: `src/features/reading/ReadingArticlePage.tsx`
- Modify: `src/features/reading/readingStore.ts`
- Modify: `src/features/reading/ReadingArticlePage.test.tsx`

**Interfaces:**
- ReadingPage accepts `articleId` from query string, loads `ArticleDocument`, renders blocks, and passes that id to existing progress/annotation/query persistence.

- [ ] Write failing tests for dynamic article title/blocks and article-specific progress/annotations.
- [ ] Run the page tests and verify expected failures.
- [ ] Replace hardcoded body with ArticleDocument block renderer; keep existing word lookup behavior for bundled fallback content and preserve stable offset annotations.
- [ ] Add bundled legacy document as an offline-safe fallback only, not as Feed data.
- [ ] Run page tests and verify they pass.
- [ ] Commit `feat: render reading documents in article page`.

### Task 6: Reading home Feed, browsing more, favorites, and downloads

**Files:**
- Modify: `src/features/reading/ReadingHomePage.tsx`
- Modify: `src/features/reading/ReadingHomePage.test.tsx`
- Modify: `src/styles/app.css`

**Interfaces:**
- Home consumes cached Feed items, switches `recommend/more/favorites/history` in place, opens `/reading/article?id=...`, and downloads a parsed `ArticleDocument` through the repository.

- [ ] Write failing tests for browse-more in-place rendering, item navigation, BBC metadata display, and download retention.
- [ ] Run home tests and verify expected failures.
- [ ] Replace fake recommendation/recent arrays with Feed/ReadingRecord projections, preserving current layout and adding a same-page `more` view.
- [ ] Implement download button with loading/error toast and local document persistence.
- [ ] Run home tests and verify they pass.
- [ ] Commit `feat: connect reading home to BBC feed`.

### Task 7: Full verification and required final commit

- [ ] Run `pnpm test` and record the result.
- [ ] Run `pnpm build` and record all remaining errors; do not hide unrelated pre-existing errors.
- [ ] Inspect `git diff --check` and verify only intended files are staged.
- [ ] Create final Chinese commit: `feat: 接入 BBC 新闻并替换阅读页假数据`.

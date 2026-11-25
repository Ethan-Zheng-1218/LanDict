# Findings

## Existing project

- 阅读文章内容目前硬编码在 `src/features/reading/ReadingArticlePage.tsx`，依赖 `readingContent.ts` 的单篇标题、正文词典和目录。
- 阅读状态集中在 `readingStore.ts`，目前保存进度、完成状态、offset/quote 批注和查词记录；文章收藏仍是页面局部 state。
- `ReadingHomePage.tsx` 的推荐、最近阅读、收藏内容仍是演示数组，`浏览更多` 只弹 toast。
- 当前路由固定为 `/reading/article`，需要扩展为 query `id`，不能新建第二个阅读器。
- `browserStorage.ts` 已提供带 version 的 localStorage 封装，可复用于 Feed/Article repository。
- Vite 已有 middleware API 模式，但 BBC 数据层应优先设计为 browser fetch + 注入 fetch，避免 ReadingPage 依赖开发服务器。

## External data

- BBC 官方开发资料列出 News RSS feed；主 feed 使用 `https://feeds.bbci.co.uk/news/rss.xml`，分区 feed 采用同样的 `/news/<section>/rss.xml` 形式。
- RSS 和文章 HTML 都视为不可信输入，只读取允许字段，不能执行或注入原始 HTML。

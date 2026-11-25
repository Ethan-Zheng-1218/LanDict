# Progress

## 2026-10-04

- 完成现有阅读模块检查。
- 完成 BBC Source/Parser/Repository/ReadingPage 边界设计。
- 完成 BBC 设计文档和实施计划草稿。
- 既有阅读选区工具条修正已在 commit `537d7ff` 提交。
- Task 1 的 ArticleDocument 类型和本地文章仓储已实现，3 个仓储测试通过。
- Task 2 BBC Source 已实现并通过 3 个测试；RSS 仅保留最近 5 天合法条目，文章 HTML 获取保持在 Source 边界内。
- Task 3 BBC Parser 已实现并通过 2 个测试，正文白名单转换覆盖 paragraph/heading/image/quote/list。
- Task 4 FeedRepository 已实现并通过 3 个测试；缓存优先、单次刷新、失败 fallback 和下载条目保留均已覆盖。
- Task 5 ReadingPage 已改为按 query articleId 读取 ArticleDocument，并通过 18 个页面测试；bundled 文章仅作为既有默认文章的离线 fallback。
- Task 6 阅读首页已接入 Feed、浏览更多、收藏记录和离线下载；首页 4 个测试通过。新增代码 TypeScript 检查已通过，剩余 4 个错误仍在原有翻译/生词文件。
- 全量测试通过：29 个测试文件、144 个测试。
- 构建仍被原有 4 个 TypeScript 错误阻断；BBC 接入没有新增 TypeScript 错误。
- 增加 Vite 同源 BBC 代理，浏览器端优先使用 `/api/bbc-feed` 和 `/api/bbc-article`，降低 CORS 风险。

## Errors

- 当前项目 `pnpm build` 已知存在 4 个与本任务无关的 TypeScript 错误，位于 `DictionaryPanel.tsx` 和 `VocabularyPage.tsx`；最终仍需报告。

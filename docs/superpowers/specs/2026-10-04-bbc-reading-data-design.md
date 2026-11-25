# BBC 阅读数据接入设计

## 目标

将 LanDict 阅读模块从单篇硬编码演示文章切换为 BBC News 数据，同时保留现有阅读首页与阅读器 UI，并让在线文章与下载文章共用同一套 `ArticleDocument` 和阅读状态。

## 统一数据模型

`ArticleDocument` 是 ReadingPage 唯一依赖的文章模型：

- `id`、`source`、`title`、`summary`、`originalUrl`、`publishedAt`、`category`、`imageUrl`
- `blocks: ArticleBlock[]`
- `downloaded`、`downloadedAt`

`ArticleBlock` 使用稳定 `id`，类型包括 `paragraph`、`heading`、`image`、`quote`、`list`。正文高亮和批注继续按文章 id 保存，并以正文扁平文本的 offset/quote 定位，不依赖 BBC DOM。

## 数据链路

```text
BBC RSS / BBC article HTML
  -> BbcSource
  -> BbcParser
  -> ArticleDocument
  -> FeedRepository / ArticleRepository
  -> ReadingHomePage / ReadingArticlePage
```

BBC Source 只负责网络获取；Parser 只负责白名单字段提取。Feed 读取时先返回 localStorage 缓存，再在一次应用运行周期内后台刷新；刷新失败保留旧缓存。文章下载后完整保存转换后的 `ArticleDocument`，Feed 清理只影响未下载的 Feed 条目。

## UI 兼容

- 保留现有阅读首页布局、推荐/收藏/历史切换、继续阅读卡片和 ReadingPage 样式。
- `浏览更多` 在当前阅读首页内切换到 Feed 列表，不新增路由。
- 文章点击进入现有 `/reading/article?id=<articleId>`，ReadingPage 通过仓储读取统一文档。
- 原有查词、翻译、朗读、复制、高亮、批注、生词和阅读进度逻辑沿用。

## BBC 边界

- 当前只接入 BBC RSS，例如 `https://feeds.bbci.co.uk/news/rss.xml`。
- Feed 只保留最近 5 天条目；无法解析的单条跳过，不能阻塞整个 Feed。
- HTML Parser 只提取标题、发布时间、正文段落、小标题、图片/caption、引用和列表；忽略导航、广告、推荐、cookie、分享和页脚。
- BBC 页面结构变化或网络/CORS 受限时保留缓存；未成功转换的文章不会伪装成可离线文章。

## 测试策略

用固定 RSS/HTML fixture 测试时间过滤、缓存优先、网络 fallback、单条容错、正文 block 转换、下载离线读取和 Feed 清理保护；组件测试验证“浏览更多”和文章点击进入现有 ReadingPage。正式 BBC 网络请求不进入测试。

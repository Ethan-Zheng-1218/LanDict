# LanDict Web 应用完整闭环开发计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 每个任务都必须先写测试、再实现、再验证，并单独创建中文 Git commit。

**Goal:** 在保留现有 UI 风格的前提下，把 LanDict 的查询、生词本、阅读器和学习记录串成可持续使用的 Web 应用闭环。

**Architecture:** 延续当前 React + React Router + Vite 架构。浏览器本地存储负责用户数据，词典访问层负责 Collins/Oxford 本地词典，阅读器 iframe 继续通过 `postMessage` 与 React 宿主通信。暂不引入 Tauri、Rust、云服务、账号或远程数据库。

**Tech Stack:** React 19、TypeScript、React Router、Vite、Vitest、Testing Library、`js-mdict`、浏览器 `localStorage`、Web Speech API。

**Spec:** 本计划依据当前聊天中的 Web 端目标和仓库现状制定。

## Global Constraints

- 保留当前页面结构、配色方向和交互风格，不重新设计产品。
- 当前只实现 Web 版本，不处理 Tauri、Rust、Windows 安装包、云同步和账号系统。
- 用户数据必须在刷新网页后保留。
- Collins/Oxford 词典内容进入页面前必须转成安全的学习者可读数据，不直接把未经处理的 HTML 注入 React。
- 每完成一个阶段，必须更新或新增测试，运行验证命令，并创建中文 Git commit。
- 本地词典资源文件不自动提交到 Git；缺少资源时必须显示可理解的降级状态。

## Review Focus

- 空输入、大小写、连字符、撇号、短语、句子和多段文本的分类行为：由查询服务测试覆盖。
- MDX 资源缺失、查询不到词、词典返回超长 HTML 或异常内容：由词典 provider 测试覆盖。
- localStorage 损坏、旧数据字段缺失、跨页面更新和刷新恢复：由存储层测试覆盖。
- iframe 消息来源不可信、重复收藏、删除后详情状态失效：由 PrototypeFrame 和生词本测试覆盖。
- 浏览器不支持语音、窄屏布局和空状态：由组件测试与浏览器验收覆盖。

---

## 当前项目距离目标还缺少什么

当前已有首页、查询页、阅读首页、阅读文章原型、生词本 React 页面和基础本地生词存储；测试基线为 22 项通过，生产构建可以完成。距离完整 Web 闭环还缺少以下部分：

1. 查询历史还只是首页里的静态演示数据，没有统一存储，也不会随真实查询更新。
2. 单词查询已经能访问本地 MDX provider，但当前访问方式依赖 Vite 开发/预览服务；需要明确 Web 构建时的词典索引或资源分发方式。
3. Collins/Oxford 返回内容仍需要结构化提取音标、词性、中文释义、英文解释、例句和搭配，避免把长 HTML 当作一段释义展示。
4. AI provider 目前只有接口和未配置提示，没有统一的 loading、错误、重试和结果模型；设置页也还没有 provider 配置流程。
5. 阅读器的收藏消息已经与生词本打通，但文章进度、批注、最近阅读和学习事件还没有统一的 React 数据层。
6. 阅读器部分状态仍保存在原型 iframe 内部，刷新或重新打开文章时不能完整恢复所有学习状态。
7. “背单词”路由仍是占位页，生词本中的“开始复习”还没有真实复习流程。
8. 查询页的 provider 面板、历史记录入口、结果状态和长词典内容仍需要进一步整理。

## 推荐开发顺序

### 阶段 0：数据契约和浏览器存储基础

目标是先统一数据格式，避免查询页、阅读器和生词本各自保存一套字段。

**需要修改或创建的文件：**

- 创建 `src/lib/browserStorage.ts`：提供带版本号的 JSON 读写、损坏数据回退和事件通知。
- 修改 `src/features/vocabulary/vocabularyStore.ts`：迁移到统一存储工具，补齐 schema version、来源、更新时间和兼容旧数据的默认值。
- 创建 `src/features/history/historyStore.ts`：保存最近查询，字段为 `id`、`query`、`kind`、`source`、`createdAt`；同一查询归一化去重，最多保留 30 条。
- 创建 `src/features/learning/learningStore.ts`：先定义文章进度、批注和学习事件的类型及本地读写接口，不接 UI。
- 修改 `src/test/setup.ts`：补充 storage、storage event 和 speech API 的稳定测试 mock。
- 创建或修改对应的 `*.test.ts` 文件。

**验收标准：**

- 生词、查询历史和学习数据使用不同的版本化 key，但共享同一存储错误处理逻辑。
- localStorage 写入非法 JSON 时，页面回到空数据，不崩溃。
- 新数据刷新后能恢复；重复查询和重复收藏不会产生重复记录。
- 所有存储层测试通过，现有 22 项测试不回归。

### 阶段 1：查询系统完整化

目标是完成“输入 → 分类 → 本地词典或 AI provider → 展示 → 历史 → 收藏”的查询闭环。

**需要修改或创建的文件：**

- 修改 `src/features/translation/translationService.ts`：固定单词、短语、句子、段落的分类规则和统一 `QueryResult` 模型。
- 修改 `src/features/translation/dictionaryProvider.ts`：输出结构化 `DictionaryEntry`，至少包含词头、英式音标、美式音标、词性、中文释义、英文释义、例句、搭配和 provider 名称。
- 创建 `scripts/build-dictionary-index.mjs` 或等价的 Web 构建脚本：从本地 MDX 生成按词查询的轻量索引；不把原始 MDX 粗暴打进 JS bundle。
- 修改 `vite.config.ts`：保留开发环境查询接口作为本地词典 fallback，并处理词典文件缺失。
- 修改 `src/features/translation/aiTranslationProvider.ts`：统一 `idle/loading/success/error/unconfigured` 状态和 provider 错误信息，继续保留未来 API 配置接口。
- 修改 `src/features/translation/QueryPage.tsx`：加入 loading、空结果、词典错误、AI 未配置提示、历史写入和结构化 provider 展示。
- 修改 `src/features/home/HomePage.tsx`：查询成功后写入历史，首页读取真实历史而非静态数组。
- 修改 `src/app/AppFrame.tsx`：查询入口提交时统一调用查询历史写入逻辑，保留现有导航。
- 更新 `translationService.test.ts`、`dictionaryProvider.test.ts`、`QueryPage.test.tsx`、`HomePage.test.tsx`。

**验收标准：**

- 单词优先读取 Collins/Oxford；任一词库缺失时仍能显示另一词库或明确降级提示。
- 短语进入 AI provider 状态；句子和段落不会误判成单词。
- 未配置 AI 时展示友好提示，不发送不存在的请求。
- 查询历史能在首页显示，刷新后仍然存在，重复项按最近时间更新。
- 词典长内容被拆成学习者可读区域，不渲染未经处理的原始 HTML。
- 测试覆盖成功、空结果、资源缺失、provider 错误和输入分类。

### 阶段 2：生词本数据和学习操作完善

目标是让生词本成为所有入口共用的真实数据中心。

**需要修改或创建的文件：**

- 修改 `src/features/vocabulary/vocabularyStore.ts`：补充批量读取、按来源/熟悉度筛选、更新时间排序和 schema 迁移。
- 修改 `src/features/vocabulary/VocabularyPage.tsx`：将真实词典字段映射到当前参考布局，支持选择、删除、备注、熟悉度更新和完整释义跳转。
- 修改 `src/features/translation/QueryPage.tsx`：收藏时保存结构化 Collins/Oxford 数据，取消收藏时同步移除。
- 修改 `src/components/prototype/PrototypeFrame.tsx`：保证 iframe 收藏、删除和宿主 React 数据实时同步。
- 修改 `design html/阅读器文章页.html`：收藏时发送完整词条信息，不只发送单词字符串。
- 更新 `VocabularyPage.test.tsx`、`vocabularyStore.test.ts`、`PrototypeFrame.test.tsx`、`QueryPage.test.tsx`。

**验收标准：**

- 查询页收藏、阅读器收藏和生词本显示的是同一条数据。
- 删除、备注、熟悉度修改在刷新后仍然存在。
- 词典缺少例句或音标时，详情栏显示明确空状态。
- 当前选中词被删除后，详情栏自动切换或显示空状态。
- storage event 和同页自定义事件都不会造成重复记录或死循环。

### 阶段 3：阅读器学习闭环

目标是把阅读器原型中的学习行为持久化到 React 侧。

**需要修改或创建的文件：**

- 创建 `src/features/reading/readingStore.ts`：保存文章进度、最后阅读时间、文章完成状态和批注列表。
- 修改 `src/components/prototype/PrototypeFrame.tsx`：增加并校验 `reading:progress`、`reading:annotation:add`、`reading:annotation:remove` 消息；向 iframe 注入进度和批注 seed。
- 修改 `design html/阅读页首页.html`：从宿主读取继续阅读信息，点击文章时发送打开事件。
- 修改 `design html/阅读器文章页.html`：发送阅读进度、批注变化和文章完成事件；单词查询和收藏继续复用已有桥接。
- 修改 `src/features/reading/ReadingHomePage.tsx` 和 `ReadingArticlePage.tsx`：传入文章标识和 seed 数据。
- 更新 `PrototypeFrame.test.tsx`，新增 `readingStore.test.ts`。

**验收标准：**

- 点击文章内单词可以查询并加入共享生词本。
- 添加、删除批注后刷新文章仍能恢复。
- 阅读滚动或阅读进度变化后，阅读首页能显示继续阅读百分比。
- 离开文章再回来，文章进度和最近阅读时间保持正确。
- 非法 iframe 消息不会写入 localStorage。

### 阶段 4：查询页和词典内容学习化展示

目标是提升现有查询页的信息层次，保持参考图的布局和视觉风格。

**需要修改或创建的文件：**

- 修改 `src/features/translation/QueryPage.tsx`：按词典、AI、例句和搭配分区；支持 provider 加载状态；收藏按钮显示当前状态。
- 创建 `src/features/translation/DictionaryPanel.tsx`：负责单个词典 provider 的结构化展示，避免继续把所有内容塞在 QueryPage 中。
- 创建 `src/features/translation/QueryHistory.tsx`：展示历史查询并支持重新打开。
- 修改 `src/styles/app.css`：只做必要的内容密度、滚动、空状态和响应式调整，沿用已确认的视觉语言。
- 更新 QueryPage 和相关组件测试。

**验收标准：**

- Collins/Oxford 的中文释义、英文解释、例句和搭配能分层阅读。
- 查询结果 loading、错误、无结果和 AI 未配置状态有明确界面。
- 英式和美式发音按钮在支持 Web Speech API 的浏览器中可用，不支持时不会报错。
- 通过窄屏浏览器检查，内容不会被详情栏遮挡或横向溢出。

### 阶段 5：学习记录和最小复习闭环

目标是兑现已有“背单词”和学习记录入口，范围只覆盖当前 Web 目标所需的最小功能。

**需要修改或创建的文件：**

- 创建 `src/features/review/ReviewPage.tsx`：从生词本读取未复习和学习中的词，支持“记住了/继续学习”两种操作。
- 创建 `src/features/review/ReviewPage.test.tsx`：覆盖空列表、熟悉度更新和刷新恢复。
- 创建 `src/features/learning/LearningHistory.tsx` 或在 `HomePage.tsx` 中读取 `learningStore`：显示最近阅读、查询和复习事件。
- 修改 `src/app/routes.tsx`：将 `/review` 从占位页替换为最小可用复习页。
- 修改 `src/features/home/HomePage.tsx`：读取真实学习记录，移除静态演示历史。
- 更新 `AppFrame.test.tsx` 和首页测试。

**验收标准：**

- 生词本的“开始复习”进入真实复习页面。
- 复习操作会更新生词熟悉度，并写入学习记录。
- 首页学习记录来自真实查询、阅读和复习行为。
- 没有生词时显示空状态，不出现无法点击的视觉按钮。

### 阶段 6：Web 版本发布前加固

目标是确认当前 Web 版本可重复启动、可验证、可交付。

**需要修改或创建的文件：**

- 修改 `package.json`：整理 `dev`、`build`、`test`、词典索引生成命令。
- 修改 `README.md`：写明本地词典文件放置位置、开发启动方式、AI provider 当前限制和数据存储位置。
- 必要时修改 `.gitignore`：确保原始 MDX/MDD、生成索引和构建产物不会误提交。
- 补充端到端或浏览器验收脚本，优先复用现有测试基础设施。

**验收标准：**

- 新环境执行安装、启动、测试和构建的步骤清晰且可重复。
- 词典文件存在和缺失两种情况下都能启动 Web 页面。
- `pnpm test` 全部通过，`pnpm build` 成功。
- 手工验收完成：查询、收藏、刷新、生词本、阅读器收藏、批注、进度和复习。
- 每个阶段都有独立中文 commit，最终工作区干净。

## 技术风险

1. MDX/MDD 文件体积、编码、加密和授权条件可能限制静态 Web 部署。推荐先保留本地 provider，再生成按词拆分的轻量索引，并对资源缺失做降级；不要把完整 HTML 直接塞进前端包。
2. Collins/Oxford 条目结构不完全一致，音标、词性和例句提取不能只依赖单一 CSS selector。解析器需要保留原始字段和安全纯文本 fallback，并用真实词条做回归样本。
3. iframe 与 React 之间的消息通信可能出现重复事件、过期 seed 或来源伪造。所有消息都要校验 `event.source`、`source`、`type` 和字段类型。
4. localStorage 没有事务和跨标签页一致性保证。当前阶段可以用自定义事件加 `storage` 事件解决同源页面同步，但不承诺多设备或云同步。
5. Web Speech API 依赖浏览器和系统语音包。界面应把朗读视为增强功能，不能让发音失败阻断查询和收藏。
6. 阅读器原型继续使用 iframe，长远会增加 React 状态、原型脚本和测试之间的维护成本。本阶段只扩展桥接协议，不进行整篇阅读器重写。
7. 真实 MDX 释义可能很长，直接展示会破坏当前布局。必须在 provider 层结构化、截断和分段，在详情页提供继续查看入口。
8. 现有 `js-mdict` 解析逻辑位于 Vite 配置侧，若未来部署为纯静态文件，接口不会随 `dist` 自动存在。阶段 1 和阶段 6 必须明确“开发服务查询”和“构建后静态索引”的边界。

## Git 与验证节奏

每个阶段按以下节奏执行：

1. 先为该阶段写失败测试。
2. 运行对应测试，确认失败原因属于缺少目标功能。
3. 实现最小改动并保持现有 UI。
4. 运行该阶段测试，再运行完整 `pnpm test` 和必要的 `pnpm build`。
5. 进行一次浏览器手工验收。
6. 创建简短中文 commit，例如“添加查询历史存储”或“保存阅读进度与批注”。


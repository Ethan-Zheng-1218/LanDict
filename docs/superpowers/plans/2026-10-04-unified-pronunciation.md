# 统一英美音标与发音实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在查词页、阅读器和生词本统一展示牛津解码后的英美 IPA，并分别播放免费英音与韦氏美音。

**Architecture:** 服务端从 OALD7 词头抽取 Kingsoft 编码的 BrE/NAmE，解码为 Unicode IPA，再通过本地词典接口提供统一发音数据。前端建立一个共享的发音加载器和播放函数；三个正式页面与静态原型只使用这份规范化数据和一致的回退规则。

**Tech Stack:** TypeScript、Vite middleware、React 19、Vitest、JSDOM、MDict。

**Spec:** `docs/superpowers/specs/2026-10-04-unified-pronunciation-design.md`

## Global Constraints

- IPA 字段只能存储 Unicode IPA，不能存 ECDICT 原始音标或韦氏重拼。
- BrE IPA 优先牛津；NAmE IPA 优先牛津，缺失时才使用免费 IPA 后备。
- 英式音频优先免费 DictionaryAPI；美式音频优先 Merriam-Webster；不可用时使用匹配口音 TTS。
- 查词页、阅读器、生词本和静态原型保持相同的英/美标签及语义。
- 每个完成的改动任务都必须创建中文 Git commit。

## Review Focus

- 词条没有 `NAmE` 时，美式 IPA 必须明确走免费后备，而不是显示韦氏重拼。
- 牛津音标含 `(r)`、主/次重音或多个释义时，解码器不能输出半截或非 IPA 字符。
- 同一词的异步请求切换后，旧词结果不能覆盖当前词的发音数据。
- 音频 URL 失效时，两个按钮必须按各自口音回退 TTS。
- 旧版生词本记录打开后必须被规范数据更新，而不是继续显示旧 ECDICT/韦氏文本。

---

### Task 1: 牛津音标解码与本地接口

**Files:**
- Modify: `server/oxford.ts`
- Modify: `vite.config.ts`
- Test: `server/oxford.test.ts`

**Interfaces:**
- Produces: `queryOxfordPronunciation(word: string): OxfordPronunciation`，其中含 `britishIpa` 与可选 `americanIpa`。
- Consumed by: 本地字典接口和前端发音服务。

- [ ] 编写 `schedule`、`water` 与无 NAmE 词条的失败测试，断言 BrE/NAmE 输出为 `/.../` Unicode IPA。
- [ ] 运行 `pnpm test -- server/oxford.test.ts`，确认新增断言在实现前失败。
- [ ] 在 `server/oxford.ts` 实现词头提取、Kingsoft 到 IPA 的纯解码函数及 `queryOxfordPronunciation`。
- [ ] 扩展 `/api/local-dictionary` 返回 `oxfordPronunciation`，保留现有牛津搭配/例句响应。
- [ ] 运行对应测试并确认通过。
- [ ] 提交：`feat: 解码牛津英美音标`。

### Task 2: 统一发音服务与来源优先级

**Files:**
- Modify: `src/features/translation/pronunciationService.ts`
- Modify: `src/features/translation/pronunciationService.test.ts`
- Modify: `src/features/translation/dictionaryProvider.ts`
- Modify: `src/features/translation/dictionaryProvider.test.ts`

**Interfaces:**
- Consumes: `oxfordPronunciation`、韦氏 `audioUrl`、免费 IPA/音频服务。
- Produces: `fetchWordPronunciation(word, signal?): Promise<WordPronunciation>` 与统一播放所需的每口音数据。

- [ ] 编写来源优先级失败测试：牛津 BrE/NAmE 覆盖免费 IPA，缺 NAmE 时才使用免费美式 IPA，韦氏重拼永不作为 IPA。
- [ ] 运行发音服务和 provider 测试，确认新增测试失败。
- [ ] 定义共享发音类型并实现加载、取消和口音音频来源选择。
- [ ] 使字典 provider 不再把韦氏重拼写入 `americanPhonetic`。
- [ ] 运行对应测试并确认通过。
- [ ] 提交：`feat: 统一音标与音频来源`。

### Task 3: 查词页采用统一模型

**Files:**
- Modify: `src/features/translation/QueryPage.tsx`
- Modify: `src/features/translation/QueryPage.test.tsx`

**Interfaces:**
- Consumes: `fetchWordPronunciation`。
- Produces: 查询页固定的英/美 IPA 按钮，以及可持久化的规范音标。

- [ ] 编写失败测试，验证两个按钮展示统一 IPA，英式使用英音 URL、美式使用韦氏 URL，并且保存内容是同一对 IPA。
- [ ] 运行 `pnpm test -- src/features/translation/QueryPage.test.tsx`，确认失败。
- [ ] 以统一模型替换各自独立的 Wiktionary/DictionaryAPI 状态与播放调用。
- [ ] 运行对应测试并确认通过。
- [ ] 提交：`feat: 查词页统一英美发音`。

### Task 4: 阅读器、生词本与静态原型统一

**Files:**
- Modify: `src/features/reading/ReadingArticlePage.tsx`
- Modify: `src/features/reading/ReadingArticlePage.test.tsx`
- Modify: `src/features/vocabulary/VocabularyPage.tsx`
- Modify: `src/features/vocabulary/VocabularyPage.test.tsx`
- Modify: `design html/阅读器文章页.html`
- Modify: `design html/生词本.html`

**Interfaces:**
- Consumes: `fetchWordPronunciation` 及共享播放辅助函数。
- Produces: 阅读器与生词本与查词页一致的双 IPA 展示和按口音播放行为。

- [ ] 编写阅读器与生词本失败测试，验证显示两套 IPA、英美按钮使用匹配音频，以及旧记录可被规范数据回填。
- [ ] 运行两组页面测试，确认新增测试失败。
- [ ] 移除页面本地的 ECDICT/韦氏音标回填和分散播放逻辑，改接共享模型。
- [ ] 同步两个静态原型为双 IPA 标签和对应英/美 TTS 演示。
- [ ] 运行阅读器、生词本测试并确认通过。
- [ ] 提交：`feat: 统一阅读器和生词本发音`。

### Task 5: 回归验证与收尾

**Files:**
- Modify: 仅为修复本计划范围内失败测试所需的文件。

**Interfaces:**
- Consumes: 前四项的完整实现。
- Produces: 通过的全量测试和生产构建。

- [ ] 修正韦氏 `schedule` 变体测试，使其匹配已定义的“只保留主发音”行为。
- [ ] 运行 `pnpm test`；排查并修复本计划范围内的失败。
- [ ] 运行 `pnpm build`，确认 TypeScript 检查与 Vite 构建通过。
- [ ] 检查 Git diff，确认未包含用户已有的 CDB 设计文件变更。
- [ ] 提交：`test: 完善发音统一回归验证`。

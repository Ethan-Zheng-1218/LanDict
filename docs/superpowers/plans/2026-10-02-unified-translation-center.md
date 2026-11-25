# 统一翻译中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 QueryPage 升级为 LanDict 唯一翻译中心，加入左侧“翻译”入口，统一首页快速查询、词典查询、文本翻译、历史和生词收藏。

**Architecture:** 保留 `/query` 作为唯一翻译路由，复用现有 `QueryPage`、`translationService`、本地词典、history store 和 vocabulary store。AppFrame 只负责导航与标题栏查询入口，QueryPage 根据 URL `q` 参数管理空状态、结果状态和历史交互。

**Tech Stack:** React 18, React Router, TypeScript, Vitest, Testing Library, Vite, 现有 shadcn/Base UI 组件和 CSS。

**Spec:** `docs/superpowers/specs/2026-10-02-unified-translation-center-design.md`

## Global Constraints

- 不创建第二套查询页面、查询服务或历史数据层。
- 继续使用现有 `/query` 路由、`QueryPage`、`translationService`、Collins/Oxford 本地词典和 `QueryHistory`。
- 不修改阅读器、生词本、复习业务及 Tauri/Rust。
- 短语、句子、段落只显示一个 AI 翻译面板；AI 未配置不得阻塞本地单词词典。
- 每个任务先写失败测试并验证失败，再实现、验证并提交中文 Git commit。

## Review Focus

- 直接访问 `/query` 不应再意外查询默认示例词；测试空状态。
- 首页输入短语、句子和段落都必须保持原文并跳转同一个 `/query` 路由；测试编码后的 URL。
- 单词本地结果在 `fetch` 不可用或失败时仍可渲染；测试本地词典与 AI 面板独立。
- 文本查询只显示一个 AI 翻译面板，避免残留多套学习/语法面板；测试面板数量和未配置提示。
- 翻译导航的选中状态不能误标首页，且阅读、生词本和复习导航仍保持原路径；测试导航顺序与 aria-current。

### Task 1: 统一翻译导航与首页入口

**Files:**
- Modify: `src/app/AppFrame.tsx`
- Test: `src/app/AppFrame.test.tsx`
- Test: `src/features/home/HomePage.test.tsx`

**Interfaces:**
- Produces: `APP_NAV_ITEMS` with `翻译` pointing to `/query`; `isNavItemActive` treats only `/` as home and `/query` as translation.

- [ ] **Step 1: Write failing tests**
  - Assert nav labels and order are `首页`, `翻译`, `阅读`, `生词本`, `背单词`, `AI学习`.
  - Assert `/query?q=cat` marks the `翻译` link with `aria-current="page"`, while `/` marks only `首页`.
  - Assert the HomePage submit path remains `/query?q=<encoded input>` for a phrase.
- [ ] **Step 2: Run focused tests and verify expected failures**
  - Run `pnpm test src/app/AppFrame.test.tsx src/features/home/HomePage.test.tsx`.
  - Expected: missing `翻译` label/order and incorrect active state fail.
- [ ] **Step 3: Implement the navigation update**
  - Add the `Languages` icon item between home and reading, update active-route matching, preserve titlebar and existing quick-search navigation.
- [ ] **Step 4: Run focused tests and verify pass**
  - Run the same focused command; all assertions pass.
- [ ] **Step 5: Commit**
  - `git add src/app/AppFrame.tsx src/app/AppFrame.test.tsx src/features/home/HomePage.test.tsx`
  - `git commit -m "新增翻译中心导航入口"`

### Task 2: QueryPage empty state and current-query behavior

**Files:**
- Modify: `src/features/translation/QueryPage.tsx`
- Modify: `src/styles/app.css`
- Test: `src/features/translation/QueryPage.test.tsx`

**Interfaces:**
- Produces: QueryPage reads an optional `q` parameter; absent/blank `q` renders an empty state without writing history or showing result panels.

- [ ] **Step 1: Write failing tests**
  - Render `/query` and assert `输入单词、短语或句子开始查询`, no `query-results`, and no history entry is created.
  - Render `/query?q=cat` and retain current result, save-word, and history behavior.
- [ ] **Step 2: Run focused tests and verify expected failures**
  - Run `pnpm test src/features/translation/QueryPage.test.tsx`.
  - Expected: direct `/query` currently renders default `serendipity` and writes history.
- [ ] **Step 3: Implement optional-query state**
  - Replace the default query fallback with `null`/empty state handling; keep current query-derived result effects guarded; add a compact empty-state section using existing visual tokens.
  - Keep titlebar query form as the continued-search entry and avoid introducing another data layer.
- [ ] **Step 4: Run focused tests and verify pass**
  - Run the focused QueryPage test command; all existing and new tests pass.
- [ ] **Step 5: Commit**
  - `git add src/features/translation/QueryPage.tsx src/styles/app.css src/features/translation/QueryPage.test.tsx`
  - `git commit -m "完善翻译中心空状态"`

### Task 3: Result classification and provider composition

**Files:**
- Modify: `src/features/translation/translationService.ts`
- Test: `src/features/translation/translationService.test.ts`
- Modify: `src/features/translation/QueryPage.tsx`
- Test: `src/features/translation/QueryPage.test.tsx`

**Interfaces:**
- Produces: `getQueryResult` returns one `translation` AI panel for phrase/text queries; word queries retain local source panels plus the AI panel.

- [ ] **Step 1: Write failing tests**
  - Assert `getQueryResult("phase out")` has `kind === "phrase"` and exactly one panel with `id === "translation"`.
  - Assert a sentence/paragraph result has only the AI translation panel and `AI_NOT_CONFIGURED_MESSAGE`.
  - Assert a known word retains Collins, Oxford (when available), and AI panel IDs.
  - Assert QueryPage renders only one provider panel for phrase/text and still renders local dictionary panels for a word when `fetch` is unavailable.
- [ ] **Step 2: Run focused tests and verify expected failures**
  - Run `pnpm test src/features/translation/translationService.test.ts src/features/translation/QueryPage.test.tsx`.
  - Expected: phrase/text currently expose four panels.
- [ ] **Step 3: Implement the minimal result-shape change**
  - Reduce non-word panel creation to one AI translation panel; leave local dictionary loading and word panel fallback untouched.
  - Keep status and unconfigured copy from the existing AI provider.
- [ ] **Step 4: Run focused tests and verify pass**
  - Run the same focused test command; all assertions pass.
- [ ] **Step 5: Commit**
  - `git add src/features/translation/translationService.ts src/features/translation/translationService.test.ts src/features/translation/QueryPage.tsx src/features/translation/QueryPage.test.tsx`
  - `git commit -m "统一翻译结果分流"`

### Task 4: History re-query and translation page visual polish

**Files:**
- Modify: `src/features/translation/QueryPage.tsx`
- Modify: `src/features/translation/QueryHistory.tsx`
- Modify: `src/styles/app.css`
- Test: `src/features/translation/QueryPage.test.tsx`
- Test: `src/features/translation/QueryHistory.test.tsx` (create if no existing file)

**Interfaces:**
- Consumes: optional query behavior from Task 2 and result panel contract from Task 3.
- Produces: clicking an existing history item updates the current `/query?q=...` route and shows that result in the same page; empty state and result sections share current spacing, borders, colors and radius.

- [ ] **Step 1: Write failing tests**
  - Seed history with a phrase, click `重新查询：...`, and assert the current location/query result updates without rendering a second page shell.
  - Assert empty history copy remains `暂无查询历史` and history is limited to the existing five entries.
- [ ] **Step 2: Run focused tests and verify expected failures**
  - Run `pnpm test src/features/translation/QueryPage.test.tsx src/features/translation/QueryHistory.test.tsx`.
  - Expected: new same-page/empty-state assertions fail where behavior is missing.
- [ ] **Step 3: Implement only needed interaction/style updates**
  - Preserve the existing history store and navigation callback; adjust state keys/effects if needed so query changes replace displayed result cleanly.
  - Style the empty state and primary translation panel with existing light borders and spacing; do not add gradients, new dependencies, or unrelated components.
- [ ] **Step 4: Run focused tests and verify pass**
  - Run the focused command; all assertions pass.
- [ ] **Step 5: Commit**
  - `git add src/features/translation/QueryPage.tsx src/features/translation/QueryHistory.tsx src/styles/app.css src/features/translation/QueryPage.test.tsx src/features/translation/QueryHistory.test.tsx`
  - `git commit -m "完善翻译中心历史交互"`

### Task 5: Full regression verification and final commit

**Files:**
- No new production files; review all task diffs.

- [ ] **Step 1: Run full test suite**
  - Run `pnpm test`; expected all test files and tests pass.
- [ ] **Step 2: Run production build**
  - Run `pnpm build`; expected TypeScript and Vite build pass. The known entry-chunk warning may remain and is outside this feature scope.
- [ ] **Step 3: Review diff and working tree**
  - Run `git diff --check` and `git status --short --branch`; no whitespace errors and no unintended files.
- [ ] **Step 4: Commit any final test-only adjustments**
  - Use a short Chinese message only if final verification required a change; otherwise retain task commits.

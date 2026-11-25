# Mouse Lookup Implementation Plan

> **For agentic workers:** Use executing-plans to implement in this session; user has requested execution. Track steps below.

**Goal:** Windows 后台鼠标取词，显示中文释义与 AI 语境义。
**Architecture:** Rust 管理托盘/停留/UI Automation/OCR，独立 React 窗口复用查询与 AI 接口，原生 SQLite/HTTP 支持安装版。
**Tech Stack:** Tauri 2, React 19, Windows APIs, rusqlite, reqwest.
**Spec:** ../specs/2026-10-07-mouse-lookup-design.md

## Global Constraints
- 默认停留 500ms；可设置 100–3000ms；OCR 默认开启。
- 仅本地 commit，不 push；保留已有未跟踪 icon.png。
- 共享设置/查询层改动提交前运行全量测试。

## Review Focus
- 老设置缺少鼠标字段时补全且保留已有 AI 配置。
- 指针移动后延迟返回结果不能替换新词。
- 无句子不能伪造语境义；AI 失败保留词典结果。
- 多屏不同缩放与屏幕边缘卡片保持可见。
- 安装版不依赖 Vite 服务器。

## Task 1: 设置与悬浮窗
Files: settingsStore.ts/SettingsPage.tsx, features/mouseLookup/*, main.tsx.
Interfaces: MouseLookupSettings { enabled, delayMs, ocrEnabled }; HoverSample { id, word, context, source }.
- [x] 写设置迁移/用户修改、悬浮窗异步结果测试并确认失败。
- [x] 添加设置及悬浮窗；按样本清除旧请求，使用现有查询服务；接入原生事件与设置同步。
- [x] 运行相关 Vitest，确认通过。

## Task 2: 原生取词与桌面查询
Files: src-tauri/src/{lib,mouse_lookup,windows_capture,desktop_queries}.rs, Cargo.toml/tauri.conf.json/capabilities, dictionaryProvider.ts, aiTranslationProvider.ts.
Interfaces: configure_mouse_lookup(settings), mouse_lookup_snapshot(), desktop_dictionary(word), desktop_ai_request(credentials,messages,timeoutMs).
- [x] 写停留/归一化/屏幕定位与 SQLite 词形回退测试，确认失败。
- [x] 实现 Windows UI Automation + 局部 OCR、托盘、非聚焦悬浮窗、原生 SQLite/HTTP 通道。
- [x] 运行 Rust 测试及前端针对桌面桥接的测试。

## Task 3: 验证和交付
- [x] 全量 Vitest、前端生产构建、Rust 测试和桌面构建。
- [x] 在可用环境验证实际原生取词，记录支持范围与限制。
- [x] 一次独立代码审查，修复影响需求的问题。
- [x] 将测试结果记录到本计划；本地提交功能，中文说明结果，不 push。

## Execution notes
在已有 codex/soft-blue-ui 分支工作。用户已要求开始执行，继续实现，不再重复设计确认。pnpm 的 Corepack 缓存不可用时通过已安装 node_modules 中的 CLI 运行等价命令。

## 验证记录
- 最终全量 Vitest：40 个文件、346 项测试通过。日志在 git 忽略的 test-results/mouse-lookup-final-tests.log。
- npm run build 成功；cargo test 成功，9 项原生测试通过。
- Tauri debug --no-bundle 桌面可执行程序构建成功。没有生成安装器或执行发布。
- 真正调用本机 Windows OCR，对内存渲染的英文句子取到 bank 及其句子，空白点不取词。系统英文 OCR 在本机可用。
- 浏览器按 320×230 实际视口渲染现有 React 卡片，正文高度 228px、末段底部约 189px，无窗口外溢。
- 独立审查的三项问题已修复并验证：滚动/前台窗口变化重置停留计时；卡片覆盖共享间距；原生查询保留中文反查与筛选。
- 没有自动操作其他 Windows 应用来逐个验证 UI Automation 兼容性；不同浏览器、PDF 查看器和特殊控件的覆盖情况仍须实际使用确认。
- 现有阅读测试的 act 提示和构建的 CSS/分包提示仍存在，检查退出码均为 0。本次不改动无关模块。

## 鼠标取词悬浮窗优化

用户追加需求已实现：按实际文字宽度调整窗口，圆角细边框，移入卡片保持显示，复制完整内容、英式发音、主动关闭，以及点击外部后关闭。同一点关闭后不会立即重弹；长释义可滚动阅读。显示时保持不激活，只有用户按下鼠标操作卡片才允许获取焦点。

设置整理：删除默认语言栏，将单词自动查询和 AI 自动翻译开关移到翻译页 API 配置上方；三套主题均保留原始 logo。

验证：最终全量 Vitest 40 个文件、349 项通过；cargo test --lib 12 项通过；前端生产构建通过。真实浏览器视口中 push 为 228px、implementation 为 319px，复制状态正确；三套主题的 logo 均为 filter:none、mix-blend-mode:normal。原生窗口聚焦路径经独立代码审查，修复了恢复 focusable 时隐式激活的问题。完整日志为 test-results/hover-optimization-final-tests.log（Git 忽略）。

托盘与运行窗口图标：仅将与图像外围连通的近白背景变透明，保留内部白色书页与原有颜色；测试验证外围透明、内部白色和彩色像素均保留。用户最终要求只交付 exe，不生成安装器。新文件 src-tauri/target/debug/landict-updated.exe 使用 custom-protocol 嵌入生产前端，构建成功，避免覆盖可能运行中的旧版本；保持在当前目录使用已有 dictionaries/stardict.db。

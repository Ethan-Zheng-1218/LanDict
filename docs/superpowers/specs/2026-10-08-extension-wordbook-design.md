# 悬停词典插件：生词本与设置页设计

日期：2026-10-08
状态：待评审
影响范围：`pudict-extension/`

## 背景

现有插件只做一件事：鼠标在英文单词上停留 500ms，显示单词、音标与中文释义，全离线、不申请权限。本轮补齐三块能力：延迟可调、单词发音、收藏与查看生词本。

使用者自用，且要求 Windows 与 Mac 行为一致。因此不写桌面或任何外部文件，数据全部保存在插件自身。桌面版 LanDict 的 React、Tauri、AI、语音链路均不复用，插件仍是独立的静态扩展。

## 目标

1. 悬停延迟可由用户调整，默认 500ms，改动即时生效、无需刷新网页。
2. 卡片保持极简：单词、音标、中文释义、发音按钮、收藏星。
3. 收藏记录存在插件本地存储，可在设置页查看、搜索、排序、删除。
4. 取词范围补上 iframe 与 Shadow DOM。

## 不做

- 不写桌面或任何外部文件，不生成 Anki、Excel 导出文件。
- 不做 AI 解释、在线翻译、账号体系、任何网络请求。
- 不引入"掌握"状态，只有收藏；取消收藏即从生词本移除。
- 不加卡片关闭按钮，不加发布渠道。
- 不更换内置词库。
- 不新增设置项以外的功能（例如手动添加单词、批量导入）。

## 卡片

内容四样，自上而下：单词行、音标、释义。单词行右侧并排两个图标按钮。

- 发音按钮：调用 `window.speechSynthesis` 朗读当前单词，`lang` 取 `en-US`。系统无英语语音时回退默认语音，朗读失败不报错、不影响卡片。
- 收藏星：空心表示未收藏，实心表示已收藏。点击后立即切换显示并写入存储，不等待写入结果。

样式沿用现有浅色卡片（白底、圆角、阴影），按钮只用图标，不加文字、不加分隔线。卡片宽度上限保持 `min(360px, 100vw - 16px)`。

## 交互

现有取词与显示逻辑不变：鼠标碰到单词即出现、离开即消失、移入卡片内不消失、离开卡片才关闭。新增要求：

- 点击卡片内按钮不触发关闭（现有 `pointerdown` 外部点击判断已按 `containsEvent` 放行，保持）。
- 收藏星切换后卡片位置不跳动。
- 发音按钮重复点击时先取消上一次朗读，避免叠读。

## 扩展面板（popup）

点击工具栏扩展图标弹出小面板，内容三项：

1. 悬停延迟滑块：范围 200–1500ms，步进 50ms，默认 500ms，实时显示当前毫秒数。
2. 生词本数量：显示"已收藏 N 个词"。
3. 「打开生词本」按钮：调用 `chrome.runtime.openOptionsPage()`。

面板改动延迟后立即写入 `chrome.storage.local`，内容脚本通过 `chrome.storage.onChanged` 实时更新，无需刷新页面。

## 生词本存储

存储介质：`chrome.storage.local`，键名 `wordbook`，值为以单词小写为键的对象：

```js
{
  "substantial": {
    word: "substantial",
    phonetic: "/səbˈstænʃəl/",
    meaning: "n. 重要材料；a. 实质上的",
    collectedAt: 1791234567890,
    sourceUrl: "https://example.com/article",
    sourceTitle: "页面标题"
  }
}
```

- 收藏与取消收藏由内容脚本直接读写 `storage.local`，不经过后台，避免唤醒 service worker。
- 同名单词重复收藏保留首次收藏时间，不新增记录。
- 读音与释义取查询结果的当前值；查询失败（`error`）时不允许收藏。
- 设置项另存 `settings` 键，当前仅有 `hoverDelayMs`。

## 设置页（wordbook.html）

在浏览器标签页中打开的扩展设置页，同时作为 `options_ui`（`open_in_tab: true`），可从 `chrome://extensions` 的"扩展程序选项"进入。

页面结构：

- 顶部：标题、总数（"共 137 个词"）、搜索框（同时匹配英文单词与中文释义）。
- 表格列：单词 ｜ 音标 ｜ 释义 ｜ 收藏时间 ｜ 来源网页。释义默认单行截断，悬停展开。
- 排序：点击列头按单词或收藏时间排序，默认收藏时间倒序。
- 行内操作：发音按钮、删除按钮（删除后立即写回存储）。
- 分页：每页 50 条，词条不足一页不显示分页控件。
- 空状态：无收藏时显示一行提示文案，例如"还没有收藏的单词，在网页上悬停单词后点击星标即可收藏"。

来源网页显示为域名加标题，点击在新标签页打开原页面。样式与卡片同色系，页面主体宽度限制在 960px 内。

## 取词范围

当前只支持主文档的可见普通 DOM 文本，本轮补两项：

1. **iframe 正文**：`content_scripts` 增加 `all_frames: true`，各框架自行处理框架内取词。框架内出现的浮窗只属于该框架，不需要跨框架通信。
2. **Shadow DOM**：取词逻辑需穿透 Shadow Root。实现时先验证 `caretRangeFromPoint` 在 Chrome 下是否已进入影子树，若未进入，则按 `elementFromPoint` 命中结果逐层下钻 Shadow Root 后取词。

若某项在真实浏览器中无法稳定成立（例如影子树内的 `Range` 无法取得矩形），降级为"该处不取词"，不得让正常页面取词受影响。

仍然不支持，且需要在 README 写明：PDF、图片内文字、Canvas 绘制的文字、CSS 伪元素生成的装饰文字、Chrome 内部页面。

## 文件与构建

构建脚本 `tools/build.mjs` 继续用项目内 esbuild 打包，不新增依赖。新增产物：

- `popup.html` + `popup.js`（源：`src/popup-entry.js`）
- `wordbook.html` + `wordbook.js`（源：`src/wordbook-entry.js`）

新增源码模块：

- `settings.js`：延迟默认值、范围与读写封装。
- `wordbook-store.js`：收藏、取消、列表、搜索、排序、删除。
- `speech.js`：朗读封装，供卡片与设置页共用。

`manifest.json` 变更：增加 `permissions: ["storage"]`、`action`（含 popup 与图标）、`options_ui` 与 `all_frames`；版本号 0.1.0 → 0.2.0。不申请网络、`nativeMessaging`、`downloads`、`offscreen` 等权限。

## 测试

- 单元测试（vitest + jsdom，`pudict-extension/tests/`）：
  - 新增 `wordbook-store` 的收藏、去重、取消、排序、搜索、分页。
  - 新增 `settings` 的默认值与范围钳制。
  - 新增 `speech` 的调用与失败静默。
  - 更新 `hover` 测试，覆盖热更新延迟与卡片按钮点击不关闭。
- 浏览器验证（`tools/browser-smoke.mjs` + `test.html`）：新增 Shadow DOM 与 iframe 用例页，确认真实 Chrome 下取词与浮窗位置正常。
- 交付前跑插件自身测试；本次不涉及主项目公共组件，不跑主项目全量测试。

## 限制与风险

- `chrome.storage.local` 配额约 10MB，按每条记录 200 字节估算可存数万词，个人使用足够；不做配额监控。
- 生词本只存在当前电脑的当前浏览器配置，Chrome 自带同步额度不足以承载（约 100KB），跨设备不互通。使用者在 Windows 与 Mac 之间迁移需自行处理，本轮不做导出功能。
- 发音依赖系统语音包，音质机械，且离线时是否可用取决于本机语音包。
- Shadow DOM 与 iframe 取词依赖 Chrome 行为细节，实现阶段以真实浏览器验证为准。

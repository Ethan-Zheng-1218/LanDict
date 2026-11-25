# 插件生词本与设置页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. 用户已要求开始执行，实施由本会话内联完成。

**Goal:** 让插件支持延迟可调、单词发音、收藏生词并在设置页查看，同时补上 iframe 与 Shadow DOM 取词。

**Architecture:** 卡片本身无状态，只显示查询结果与两个按钮；收藏数据由内容脚本直接读写 `chrome.storage.local`，不经过 service worker。popup 负责延迟滑块与生词本入口，设置页（options）用表格展示生词本。取词逻辑在 `word-at-point.js` 内扩展到影子树，构建仍由 `tools/build.mjs` 调用项目内 esbuild 完成。

**Tech Stack:** Chrome MV3、原生 ES 模块、esbuild（项目内既有依赖）、vitest + jsdom。

**Spec:** ../specs/2026-10-08-extension-wordbook-design.md

## Global Constraints

- 不写桌面或任何外部文件；不新增网络、AI、`downloads`、`offscreen`、`nativeMessaging` 权限。
- 卡片只含单词、音标、释义、发音按钮、收藏星；不加关闭按钮。
- 数据存 `chrome.storage.local`，键为 `wordbook` 与 `settings`。
- 悬停延迟范围 200–1500ms、步进 50、默认 500ms。
- 命中 `error` 的查询不允许收藏。
- 只提交本地 Git，不 push；每次修改后提交一次。

## Review Focus

- 页面脚本报错或 `speechSynthesis` 不可用时，卡片仍能显示、收藏与关闭。
- 同一单词重复收藏不产生第二条记录；取消后再收藏刷新收藏时间。
- 鼠标从卡片按钮移到页面空白处，卡片正常关闭；点按钮不关闭。
- 影子树内取词不影响普通页面取词；取不到时静默返回 `null`。
- `storage` 为空或数据结构损坏时，设置页显示空状态而不是抛错。

## File Structure

| 文件 | 职责 |
| --- | --- |
| `settings.js` | 延迟默认值、范围钳制、读写与变更订阅 |
| `wordbook-store.js` | 收藏增删查、搜索、排序、分页（纯函数 + 存储封装） |
| `speech.js` | 朗读封装，卡片与设置页共用 |
| `tooltip.js` / `tooltip.css` | 卡片结构、按钮、位置计算 |
| `hover-controller.js` | 停留计时与显隐生命周期，支持延迟热更新 |
| `word-at-point.js` | DOM 取词，本轮加影子树支持 |
| `src/content-entry.js` | 内容脚本装配 |
| `popup.html` / `popup.css` / `src/popup-entry.js` | 工具栏面板 |
| `wordbook.html` / `wordbook.css` / `src/wordbook-entry.js` | 生词本设置页 |
| `manifest.json` | 权限、action、options_ui、all_frames |
| `tools/build.mjs` | 新增两个页面脚本的打包 |

---

### Task 1: 设置与发音基础模块

**Files:**
- Create: `pudict-extension/settings.js`, `pudict-extension/speech.js`
- Test: `pudict-extension/tests/settings.test.js`, `pudict-extension/tests/speech.test.js`

**Interfaces:**
- Produces: `HOVER_DELAY = { min: 200, max: 1500, step: 50, defaultValue: 500 }`；`normalizeHoverDelay(value) -> number`；`createSettingsStore(storage) -> { getHoverDelay(), setHoverDelay(value) }`；`watchHoverDelay(onChange, area) -> unsubscribe`；`speakWord(word, { window, lang }) -> boolean`。

- [x] 写失败测试：越界与非法值钳制到位、默认 500、`speakWord` 调用 `speechSynthesis.speak` 且取消上一次、无 `speechSynthesis` 时返回 `false` 不抛错。
- [x] 运行 `node node_modules/vitest/vitest.mjs run --config pudict-extension/vitest.config.js` 确认新测试失败。
- [x] 实现 `settings.js` 与 `speech.js`，使测试通过。

### Task 2: 生词本存储与列表操作

**Files:**
- Create: `pudict-extension/wordbook-store.js`
- Test: `pudict-extension/tests/wordbook.test.js`

**Interfaces:**
- Produces: `wordKey(word) -> string`；`createWordbookStore(storage) -> { list(), has(word), add(record), remove(word) }`；`searchEntries(entries, query)`；`sortEntries(entries, field, direction)`；`paginate(entries, page, pageSize)`。
- 记录形状：`{ word, phonetic, meaning, collectedAt, sourceUrl, sourceTitle }`。

- [x] 写失败测试：收藏写入、同名单词重复收藏保留首次时间且不新增、取消后重新收藏更新时间、搜索同时匹配英文与中文、按时间倒序与字母升序排序、分页边界、损坏数据返回空列表。
- [x] 运行测试确认失败，然后实现 `wordbook-store.js` 使其通过。

### Task 3: 卡片按钮与收藏交互

**Files:**
- Modify: `pudict-extension/tooltip.js`, `pudict-extension/tooltip.css`, `pudict-extension/hover-controller.js`, `pudict-extension/src/content-entry.js`
- Test: `pudict-extension/tests/tooltip.test.js`, `pudict-extension/tests/hover.test.js`

**Interfaces:**
- `createTooltip(document, css, handlers)`，`handlers = { speak(record), isCollected(word), toggleCollected(record) }`；`show(sample, point)`、`update(result)`、`hide()`、`containsEvent(event)` 签名不变。
- `attachHoverLookup({ ..., delay })` 中 `delay` 允许为函数，每次计时取其返回值。

- [x] 写失败测试：发音按钮调用 `speak`；收藏星初始状态来自 `isCollected`、点击后立即翻转并按返回值收敛；`status !== "success"` 时隐藏收藏星；延迟传函数时使用返回值。
- [x] 运行测试确认失败，实现改动使全部通过（含既有测试）。
- [x] 让内容脚本装配存储、发音与查询，`run_at: document_idle` 时读取一次设置并订阅变更。

### Task 4: 工具栏面板

**Files:**
- Create: `pudict-extension/popup.html`, `pudict-extension/popup.css`, `pudict-extension/src/popup-entry.js`

- [x] 实现滑块（200–1500，步进 50，实时显示）与生词本数量、`打开生词本` 按钮（`chrome.runtime.openOptionsPage()`）。
- [x] 手动在浏览器确认滑块改变后悬停延迟随之改变、数量与实际收藏一致。

### Task 5: 生词本设置页

**Files:**
- Create: `pudict-extension/wordbook.html`, `pudict-extension/wordbook.css`, `pudict-extension/src/wordbook-entry.js`

**Interfaces:**
- 使用 Task 2 的 `createWordbookStore`、`searchEntries`、`sortEntries`、`paginate` 与 Task 1 的 `speakWord`。

- [x] 实现表格（单词、音标、释义、收藏时间、来源）、搜索框、列头排序、每页 50 条分页、行内发音与删除、空状态。
- [x] 手动确认删除后立即写回存储、来源链接可打开原页面。

### Task 6: manifest 与构建

**Files:**
- Modify: `pudict-extension/manifest.json`, `pudict-extension/tools/build.mjs`

- [x] `manifest.json` 增加 `permissions: ["storage"]`、`action`、`options_ui`（`open_in_tab`）、`all_frames`，版本号改 0.2.0。
- [x] `tools/build.mjs` 增加 `popup.js` 与 `wordbook.js` 两个 IIFE 产物。
- [x] 运行 `node pudict-extension/tools/build.mjs`，确认四个产物生成且 `content.js` 仍为单文件无外部依赖。

### Task 7: 取词范围（Shadow DOM 与 iframe）

**Files:**
- Modify: `pudict-extension/word-at-point.js`
- Modify: `pudict-extension/test.html`
- Create: `pudict-extension/test-frame.html`
- Test: `pudict-extension/tests/word-at-point.test.js`

**Interfaces:**
- `wordAtPoint(x, y, document)` 返回值形状不变：`{ word, range, rects }` 或 `null`。

- [x] 写失败测试：影子根内文本可命中；影子根内取词不受宿主 `[contenteditable]` 影响；影子树取不到时返回 `null` 且不抛错。
- [x] 实现按最深层命中元素定位取词根，再取该根内 caret 的逻辑。
- [x] 更新 `test.html` 增加 Shadow DOM 与 iframe 段落，新增 `test-frame.html`。
- [x] 用真实 Chrome 加载解压扩展确认两处可取词；若影子树不可取词，按规格降级为不取词并在 README 记录。

### Task 8: 验证与文档

- [x] 运行插件全部测试，确认通过。
- [x] 更新 `README.md`：新增延迟设置、发音、生词本与设置页说明，补充取词范围与限制。
- [x] 用真实 Chrome 加载解压扩展，人工走查卡片、面板、生词本页；记录结果到本计划。
- [x] 本地提交，不 push。

## 执行记录

### 结果

- 单元测试：`node node_modules/vitest/vitest.mjs run --config pudict-extension/vitest.config.js` → 7 个文件、51 项通过（原 28 项，新增设置 4、朗读 2、生词本 8、影子树取词 3，并扩展 hover 2 项、tooltip 1 项）。
- 真实浏览器：`node pudict-extension/tools/browser-check.mjs` → 10 组检查全部通过，无页面异常。Chrome 以无头模式、一次性临时配置加载解压扩展，覆盖卡片音标与中文释义、喇叭按钮、星标收藏、Shadow DOM 取词、iframe 取词、面板词数与延迟写入、面板打开生词本页、延迟热更新对已打开页面生效、生词本页列出与删除、来源单元格内容。结果存于 `.test-artifacts/browser-check.json`。
- 构建：`node pudict-extension/tools/build.mjs` 生成 `content.js`、`service-worker.js`、`popup.js`、`wordbook.js`，未新增依赖。
- 本次不涉及主项目公共组件、路由或数据层，按项目测试策略未运行主项目全量测试。插件测试已全部运行。

### 实施中发现并修复的问题

影子树取词的首版实现在真实 Chrome 中取不到词。实测探针显示：`document.caretRangeFromPoint` 在影子树上方返回的是外层 `SECTION` 的插入点（`caretInShadow: false`），`ShadowRoot.caretPositionFromPoint` 不存在，而 `document.caretPositionFromPoint(x, y, { shadowRoots })` 能返回影子树内的文本节点。据此改为「先按下钻影子根定位真实元素，再把影子根链交给带 `shadowRoots` 的 `caretPositionFromPoint`」，并补了对应的单元测试与「不支持时不返回外层错词」的测试。

### 遗留限制

### 追加需求（2026-10-08，卡片收窄与离开延迟）

用户反馈卡片太宽，并说明原因：长中文释义把卡片撑到最宽，长单词与右侧按钮同一行也会加宽。要求：按钮移到单词下方、音标之后；中文释义按卡片宽度自动换行；鼠标离开单词后延迟约 0.3 秒再消失。

实现：卡片结构改为「单词 → 音标行（音标在左，发音与收藏按钮在右）→ 释义」；卡片宽度上限由 360 px 收到 260 px（下限 180 px），长释义在卡片内换行、不再撑宽，释义加 `text-wrap: pretty` 避免末行只剩一个字；离开单词的缓冲由 150 ms 改为 300 ms（`hover-controller.js` 的 `HIDE_GRACE_MS`）。

验证：单元测试 53 项通过（新增悬停延迟边界、卡片结构两项）；真实浏览器检查新增三项并全部通过——卡片实测宽 260 px、按钮位于音标行且低于单词、释义换行、离开后约 318 ms 关闭；截图存于 `.test-artifacts/card.png`。

第二轮反馈：260 px 仍偏宽，要求「宽度以单词长度决定，最多比单词宽一点点」，并确认音标、发音、收藏三个元素应紧跟单词下方（按钮紧跟音标，不推到右边）。

实现：卡片宽度改由 `tooltip.js::fitWidth()` 按内容计算——取「单词自然宽度」与「音标 + 间隔 + 两个按钮」的较大者，加 26 px 内边距与描边，范围 140–320 px，长释义只在该宽度内换行；按钮取消右对齐，紧跟音标。

验证：单元测试 57 项通过（新增卡片宽度公式三项）；真实浏览器检查显示 131 px 宽的单词得到 157 px 宽的卡片、按钮紧跟音标（间距 ≤ 12 px）、释义仍换行、离开延迟 322 ms，其余检查不变。

第三轮反馈：长单词 `entertainment` 被折成两行；发音与音标应绑成一个可点击药丸（喇叭在前，带阴影表示可点，点击发声，不加“英/美”标注）；收藏星回到右上角，宽度按「单词 + 星标」增加但仍要窄。

实现：卡片结构改为「head（单词 + 右上角星标）→ pronounce 药丸（喇叭图标 + 音标，整块可点）→ 释义」；宽度公式 `cardWidth(headWidth, pillWidth)` 取两者较大值加内边距与描边，范围 140–320 px。折行根因是原先用 `scrollWidth` 测宽：它返回整数，长单词的小数部分被舍去后内容盒比文字窄不到 1 px，`overflow-wrap: anywhere` 就把最后一个字母折到下一行；改为用影子根内隐藏探针量取小数宽度并加 2 px 余量。

验证：单元测试 58 项通过（宽度公式改为纯函数并新增一条 DOM 断言）；真实浏览器检查显示 131 px 单词得到 191 px 卡片、星标位于右上角（距边 ≤ 20 px）、喇叭与音标同处一个药丸、`entertainment` 单行且卡片 232 px、离开延迟 317 ms，其余检查不变。

第四轮反馈：卡片离开后的停留时间太短，要求做成可在面板里调整的用户设置，默认 0.7 秒；另外报告 Mac Chrome 上发音很奇怪。

实现：设置项增加 `lingerMs`（0–2000 ms，步进 100，默认 700），面板新增“卡片停留”滑块；`attachHoverLookup` 的 `linger` 参数与 `delay` 一样接受数字或函数，内容脚本通过 `watchSettings` 同步两项设置。发音改为主动挑选语音：优先 Google US English / Samantha 等正常英语语音，排除 macOS 通过 Web Speech 暴露的恶搞音效（Bubbles、Zarvox、Bad News 等），没有英语语音时才由浏览器决定；同时不再对空闲的合成器调用 `cancel()`，避免 macOS 上截掉首音节。

验证：单元测试 65 项通过（新增卡片停留的设置与控制器测试、语音挑选测试）；真实浏览器检查显示默认停留 714 ms 关闭、面板两个滑块都写入存储，其余检查不变。

第五轮反馈：词库偏小、变形词（-ing、名词化、被动式等）识别不出来。实测结论：词库 57,426 条中 44,580 条带变形声明，运行时会建立 54,372 条变形索引，所以「声明过的变形」本来就能查到；真正的缺口是 6,000 个实词（engage、enhance、showcase 等）在 ECDICT 里没有声明任何变形，它们的规则变形 100% 查不到；另外词库外的基础词（如 reimagine）整条都不会命中。

实现：`dictionary-provider.js` 增加 `lemmaCandidates()` 规则还原，查询顺序改为原词 → 声明变形 → 规则还原；规则含 -s/-es/-ies、-ed/-d/-ied、-ing/-ying、双写辅音、-er/-est（仅落到形容词）、-ly、-ness、-ment、-tion/-sion、-able/-ible、-ful/-less/-ous/-ive/-ity/-ance/-ence/-al/-ic/-ish 以及常见前缀。查询结果新增 `matchType`（exact/declared/rule），卡片在 `rule` 时显示浅色「原形 xxx」。

验证：以正确英语拼写取样 3,000 个未声明变形的实词、9,000 个形变——加规则前可识别 33 个（0.4%），加规则后 8,757 个（97.3%）；技术/营销动词列表 56 个形变全部可识别。单元测试 69 项通过；真实浏览器检查新增 `showcasing → 原形 showcase` 端到端用例并通过。

第六轮反馈：把「卡片停留」调到 2 秒，鼠标离开单词后卡片仍然立刻消失。

诊断：停留设置只作用于「移到空白」这一条路径。另有两条路径绕过它——指针从单词直接移到相邻单词时走的是「切换词条」分支，先 `clear()` 隐藏再重新计时，于是瞬间消失；鼠标移出网页（`documentElement` 的 `mouseleave`）和窗口失焦（`blur`）走的是立即清除。用户「离开单词」的实际动作大概率落在这两条路径上，所以调多大都没用。

修复：新增 `scheduleHide()`，所有「注意力移开」的路径（空白、下一个单词、移出网页、窗口失焦）统一走停留计时；只有 Esc、点击卡片外、滚动、切换标签页保持立即关闭。跨单词时不再先 `clear()`，卡片留在屏幕上、等新词结果到达后原地更新（旧结果仍被 revision 丢弃）。验证脚本另修正一处自身缺陷：打开设置页后焦点转移，真实输入事件不再送达测试页，需重新激活该标签页。

验证：单元测试 70 项通过（新增跨单词不消失、`mouseleave`/`blur` 走停留共三条）；真实浏览器检查新增三项：跨单词卡片不闪断、鼠标移出网页后约 712 ms 关闭、把停留设成 1200 ms 后实测约 1469 ms 关闭（含事件派发延迟）。

第七轮反馈：收藏星偏小且没有和单词居中对齐；首次使用长时间显示「词库暂时不可用」；提出后续要加 AI 解释，需要设置页能配置 API。

实现：星星按钮由 26 px 放大到 32 px、图标 16 → 20 px，`head` 改为 `align-items: center`，星标与单词行居中对齐。首次加载体验三处改动：内容脚本在页面加载时（仅顶层框架）发一条 `warmup` 消息提前触发词库加载，service worker 启动与 `onInstalled` 时也预热；查询失败按 400/900/1600 ms 重试最多四次（新增 `lookup.js::requestLookup`），期间卡片保持「正在查询…」；兜底提示语从「词库暂时不可用」改为「词库正在加载，请稍候…」。

验证：单元测试 75 项通过（新增查询重试 4 项、`ready()` 预加载 1 项）；真实浏览器检查新增「页面加载即预热」（确认 service worker 提前启动）与「首次悬停 861 ms 出结果」，以及星标图标 20 px、与单词行中心偏差 ≤ 2 px 两项断言，其余检查不变。AI/API 配置项尚未实现，等待用户确认接口形态后再动工。

第八轮反馈：生词本表格悬停展开释义时会「闪一下」。原因有两个：表格是 `table-layout: auto`，单元格内容变化会重算列宽；展开让页面变高后出现滚动条，整页横向位移。

实现：表格改为 `table-layout: fixed` 并用 `<colgroup>` 固定六列比例（12/15/33/16/18/6%）；单词、音标、收藏时间、来源列统一 `nowrap + ellipsis`；释义用 `-webkit-line-clamp` 从 1 行（悬停该行时）展开到 2 行，超出仍省略，完整释义保留在 `title` 里；`html` 加 `scrollbar-gutter: stable` 预留滚动条位置。展开只改变行高，列宽与表格宽度不变。

验证：真实浏览器检查新增一组断言——未悬停时释义确被截断（`scrollHeight > clientHeight`）、悬停后行高由 49 px 增至 66 px 且不超过两行、表格宽度与单词/释义/收藏时间三列的 left 位置变化均 ≤ 1 px；截图存于 `.test-artifacts/wordbook.png`。验证脚本另修两处自身缺陷：滚动打断后同一坐标不再触发取词，需先微移再重试；`-webkit-line-clamp` 的截断是纵向的，判定截断要比较 `scrollHeight` 而不是 `scrollWidth`。

第九轮反馈：生词本不显示来源网页；操作列只保留删除，把发音按钮移到音标前面并与音标组合成可点区域。

实现：表格去掉来源网页列，列宽比例改为 14/22/38/18/8；音标单元格改成一个药丸按钮（喇叭图标 + 音标），点击朗读；操作列只剩删除。存储结构不变，`sourceUrl`/`sourceTitle` 仍然记录，只是不再展示。

验证：真实浏览器检查改为断言表头为「单词/音标/释义/收藏时间/操作」且不含来源网页、音标药丸带图标与文字、操作列只有一个删除按钮；释义展开仍不移动任何列（行高 49 → 66 px）。截图见 `.test-artifacts/wordbook.png`。

第十轮：AI 解释功能。用户确认只做 OpenAI 兼容一种接口、配置放在扩展设置页（不放右上角面板）、面板里增加「AI 自动翻译」开关（开=每次自动请求，关=点卡片上的按钮请求）。

实现：新增 `ai.js`（构造 chat/completions 请求、解析 `choices[0].message.content`、判断是否已配置）；设置项增加 `aiAutoTranslate`/`aiBaseUrl`/`aiApiKey`/`aiModel`；service worker 增加 `explain` 消息（20 秒超时，读取设置后转发请求）；卡片新增「AI 解释」按钮与解释区块，开启自动翻译时跳过按钮；内容脚本用 `sentenceAround()` 取单词所在句子（最多 240 字符）一起发送；面板增加开关，设置页底部增加「接口地址 / API Key / 模型 / 保存 / 测试连接」表单；清单新增 `host_permissions: ["<all_urls>"]`。

验证：单元测试 86 项通过（新增 AI 请求构造与解析 4 项、句子上下文 2 项、设置项与开关同步 3 项、卡片按钮/自动/未配置三种行为 3 项）。真实浏览器检查新增：面板 AI 开关写入存储、设置页存在 AI 表单、手动点击后卡片显示模拟接口返回（含单词与所在句子）、开启自动翻译后无需点击即显示、模拟接口共收到 2 次请求。验证脚本另修两处自身缺陷：扩展 service worker 的 keep-alive 连接会让本地测试服务器无法关闭（改为 `closeAllConnections` 并加超时），以及 Chrome 子进程会残留（改为 `taskkill /T`）；并加了 4 分钟硬超时，避免再次挂死。

第十一轮：用户要求设置页与生词本合并为一个页面并改名「生词本 / 翻译配置」；把模型名做成「一劳永逸」（获取模型列表 + 常见服务商默认值）；AI 解释写短（不要英文改写、不要啰嗦）；卡片改成固定宽度不再随单词与解释长度变化。

实现：页面标题、浏览器标签与面板按钮统一改为「生词本 / 翻译配置」；`ai.js` 增加 `buildModelsRequest`/`readModelsResponse`/`defaultModelFor`（内置 OpenAI、DeepSeek、通义、Kimi、智谱、硅基流动、OpenRouter、本机 Ollama 的默认模型），系统提示改为「最多两句话 / 60 字以内 / 不要英文改写 / 不要复述原句 / 不要客套话」，请求体加 `max_tokens: 160`；卡片宽度固定为 250 px（`CARD_WIDTH`），长单词按 `headwordFontSize()` 自动缩小字号（25 → 最低 17 px）而不是折行或撑宽卡片；设置页模型框改为可下拉（`datalist`）并新增「获取模型列表」按钮。

验证：单元测试 86 项通过（新增模型列表解析与默认模型 3 项、提示语与 max_tokens 2 项、字号缩放 3 项）。真实浏览器检查新增/更新：短词与长词卡片宽度都是 250 px、长单词仍单行、设置页标题含「翻译配置」、「获取模型列表」从模拟接口列出两个模型、请求体含 160 tokens 与「不要英文改写」。另给每条 CDP 调用加 15 秒超时，把此前的偶发卡死变成明确报错。

### 审查（自查）

派出的独立审查子代理没有按审查角色工作：两次派发都只返回实施总结，没有给出任何按严重度分级的发现。按执行流程回退为作者自查，并在此如实记录（作者自查弱于独立审查，是否足够由你判断）。自查按 Review Focus 逐条核对代码与测试，发现并处理三项：

- 缺回归测试：Review Focus「点击卡片按钮不关闭」与 `error` 状态隐藏收藏星都没有测试，已补进 `tests/hover.test.js` 与 `tests/tooltip.test.js`。
- 偏离规格：来源网页单元格原实现只显示页面标题，规格要求「域名加标题」，已改为 `域名｜标题`。
- 未验证路径：面板「打开生词本」按钮（`chrome.runtime.openOptionsPage`）此前没有验证，已在浏览器检查中点击并断言设置页标签页被打开。

第一次写回归测试时按「hide 未被调用」断言而失败，原因是首次悬停本来就先调用一次 `tooltip.hide()` 归零状态；改为比较调用次数差后通过。

- 生词本只存在当前电脑的当前浏览器配置；Chrome 自带同步额度不足以承载，跨设备需自行处理，本版本不做导出。
- 发音依赖系统语音包，音质与离线可用性由本机语音包决定。
- 无头浏览器里个别悬停需要一次合成 `mousemove` 才能触发（检查脚本会打印 WARNING）；本次运行未出现该回退。
- 面板与生词本页只有真实浏览器走查，没有单元测试；页面内的逻辑已由 `wordbook-store` / `settings` 覆盖。

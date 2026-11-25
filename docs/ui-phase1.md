# 第一阶段：基础 UI 设计系统

## 范围

仅收口字体、字重、字号、图标、按钮和基础 Token。保留页面结构、业务事件、路由、存储、布局尺寸及响应式规则。不采用毛玻璃或新主题。

## 修改前审计

- 字体：`app.css` 使用 Segoe UI Variable、Microsoft YaHei、Georgia、Times New Roman、Avenir Next 等页面级规则；按钮和表单存在浏览器默认字体风险。
- 字重：400、500、600、640、650、700、750、760 混用。
- 公共 Button：AppFrame 4 处、HomePage 1 处；公共库另有 SidebarTrigger、SheetClose 各 1 处。
- 页面原生 button 声明共 54 处：历史 2、首页 2、阅读文章 27、阅读首页 11、设置 4、翻译历史 1、翻译 4、生词本 3。循环渲染产生的按钮实例另计。
- 可安全收口：提交、清空、发音、收藏、阅读继续/下载、窗口控制、关闭、批注保存/取消/移除、阅读工具栏动作。
- 特殊交互保留：导航/分页签、历史行、文章卡片、词典展开、目录、行内查词、标注色点/色菜单；公共 SidebarRail 保留。

## 字体和 Typography

- 全部语言、数字、表单、代码展示、阅读正文统一 `"Noto Sans SC", sans-serif`。随应用打包本机已有可变字体及 SIL 许可，不请求线上字体。
- 400 正文/辅助，500 按钮/标签/一般强调，700 标题/强强调。取消原来的中间字重和页面字体覆盖。
- xs/sm/body/title/display 等字号 Token 收口通用层级；阅读副标题、词典摘要、设置标题等保留命名语义 Token。保留原字号数值和三个响应式标题 clamp。
- 阅读正文的字号切换继续由原有 `fontSize` 状态控制（初始 18，循环 17→18→19→20→17），保持既有交互及行高，不改字号逻辑。

## 图标

- 设计资产原样保存为 `src/assets/icons/icons.svg`；公共 `icon.tsx` 通过外部 sprite 引用，不在页面绘制 SVG。
- 已替换：搜索、翻译、设置、收藏星形、朗读、删除、返回、前进、展开、复制、字号、播放/暂停、配色、提示、检查、关闭，以及专用窗口最小化/最大化/关闭。
- 统一 `viewBox="0 0 16 16"`、currentColor、1.5 描边、round 端点/连接；尺寸为 14/16/20/24。收藏取消使用状态色与 aria-pressed 区分，图形保持描边。
- 暂留 Lucide：BookOpen（阅读）、StickyNote（生词本/批注）、Heart（查词收藏）、Eraser（取消高亮）、Sparkles（AI 语境）、PanelRightOpen（阅读侧栏）、PanelLeftIcon（公共侧栏触发器）。资产库无对应图形，不自行补画；这些图标保留原 24 网格，CSS 统一描边与颜色。
- 历史入口原为文字/箭头，保留原展示，不增加图标。

## 按钮

- 公共 Button 保留 Base UI Primitive、事件与 render API；支持 primary、secondary、ghost/text、destructive、destructive-solid、link、icon，并兼容 default/outline 等现有命名。
- 标准尺寸：lg 36px/10px，默认 md 30px/10px，sm 24px/8px；图标按钮等宽高。字号大/中 13px、小 12px，文字 500，图文间隔 6px。
- 统一 hover、active（不位移）、双环 focus-visible、disabled 和已有连接测试的 loading。加载指示器用定位伪元素，不扩张按钮宽度；现有状态文案保留。
- 安全迁移 35 处原生声明：最终页面公共 Button 40 处，特殊原生 button 19 处。设置分类、阅读频道/面板页签、历史行、卡片、词典折叠等不强行合并。
- 已有按钮通过显式 `size="preserve"` 保留原几何尺寸、布局 CSS 和原色；共享字体和交互状态。标准尺寸用于公共规范，不把现有 48px 首页查询、32px 顶栏查询、34px 设置动作等强行缩小。
- 清理公共 Button 中旧的 Tailwind 尺寸/颜色/位移规则，移除页面重复字体和按钮字重声明；常规动作统一由 Button 字体与状态规则控制。

## Design Tokens

- Typography：font-sans、regular/medium/bold、各通用和语义字号。
- Spacing：4px 基础尺度及图文间距，现有布局内等值替换。
- Radius：sm/md/lg、panel、pill、circle；非标准遗留圆角命名保留，避免改变轮廓和尺寸。
- Border：默认线宽、default/subtle/divider。
- Surface：page/panel/subtle/selected/hover/reading/settings/neutral。
- Text：primary/secondary/muted/faint/heading/title。
- Interactive：primary 及 hover/active、现有 query/reading/settings/navigation 色、danger、focus、disabled、按钮尺寸/内边距。
- Icon：四档尺寸、统一描边。
- 保留现有颜色数值；仍有用途不同的局部颜色和特殊间距，未借此阶段重新配色或改变位置。

## 主动保留的布局例外

- 左栏 172px、首页顶栏 166px、其他顶栏 64px、首页搜索框及其 48px 查询按钮；所有原宽高、定位、栅格、比例和响应式断点不变。
- 阅读正文 720px 上限、阅读卡片布局、生词本左右栏、设置 760×560 上限弹窗、各模块原留白不变。
- 页面使用 preserve 按钮保留旧尺寸/圆角/颜色；标准按钮尺寸不覆盖冻结的历史行、工具栏或输入内按钮。
- 不改标签文案、删除入口形式、功能和数据；不提前落地三套主题。

## 验证

- 全量 `pnpm test`：36 个文件、298 个测试通过；收藏测试保留业务断言，将旧的填充星形断言改为描边 + aria-pressed 状态断言。
- `pnpm build`：TypeScript 检查与 Vite 生产构建通过，离线字体和 SVG sprite 均进入产物。
- 对原 CSS 的宽高、栅格、flex、位置、margin/padding/gap 等声明作 Token 展开比较，无布局数值变化（图标尺寸按本阶段规范调整）。
- 1200×750 本地浏览器抽查：首页/设置统一字体、字重 400/500/700；图标资产正常渲染，1.5 描边。完整多窗口视觉验收留在阶段 4。

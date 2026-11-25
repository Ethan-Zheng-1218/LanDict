# LanDict 前两阶段 UI 重构验收

完成基础设计系统与首页、翻译、生词本、设置的 Soft Blue 统一。阅读内部布局保留到第三阶段，离线下载入口未恢复。

## 核心文件

- `src/styles/tokens.css`：统一颜色、字体、控件尺寸、间距、圆角、边框、阴影和外壳尺寸；保留旧变量兼容映射及原编号间距。
- `src/styles/globals.css`：本地字体、基础元素、公共组件、184px/76px 侧栏、56px 顶栏。
- `src/styles/app.css`：首页、翻译、生词本和设置专属布局及响应式规则。
- `src/components/ui/`：Button、Input、Card、IconButton、SearchBox、PageHeader、Lucide 图标入口与基础组件测试。
- `src/app/AppFrame.tsx`：统一外壳尺寸与导航无障碍名称。
- `src/features/{home,translation,vocabulary,settings}/`：接入公共组件，保持原有数据来源、事件与文案。

## 最终规则

字体统一使用已打包的本地 Noto Sans SC，字重 400/500/700；工作页面正文 16px、辅助 14px、弱信息 12px、卡片标题 20px、页面标题 36px、单词标题 40px。阅读保留原有语义字号及间距。

Lucide 默认 20px、紧凑 16px、独立 24px，统一 1.8 描边、圆形端点和转角。收藏选中态使用蓝色，保留原组件导出名称。

主要按钮 42px、次要按钮 40px、紧凑按钮 32px；输入框 48px、搜索框 56px、图标按钮 36px。公共组件保留事件、引用与无障碍属性，并统一 Hover、Active、Focus-visible、Disabled、Loading。

首页保留六条纵向记录、历史/清除入口及原名言作者。翻译保留 textarea、多行输入、键盘和输入法行为、词典/AI 展开与加载时机。生词本保留全部筛选排序、英美发音与收藏恢复，桌面 40%/60%，内容宽度不足 720px 时上下排列。设置保留原字段、分区与存储规则。

## 验证

| 阶段 | 测试 | 生产构建 |
|---|---|---|
| 第一阶段 | 37 个测试文件、302 项通过 | pnpm build 成功 |
| 第二阶段 | 37 个测试文件、303 项通过 | pnpm build 成功 |

开工基线有 25 项过期测试期望失败；已对齐现有实现，未删除或跳过测试。浏览器验收另发现原有的生词本无匹配搜索空值报错：只增加空值判断，并通过新增回归测试验证失败→通过，没有改变过滤规则或存储数据。

浏览器检查尺寸：1200×750、900×750、1440×900、680×750。核心页面无横向溢出，窄窗口详情与设置内容可滚动访问。

浏览器交互验收：查询与六条记录、完整历史与清除；单词/中文反查/短语/多行、收藏、发音触发及词典失败状态；生词本筛选排序、搜索、选词、取消/恢复收藏和空状态；设置开关、配置保存及模拟接口连接测试；阅读选词、右侧词典、朗读/暂停、目录和返回导航。音频通过播放调用验证，未进行听感验收；未使用真实付费 AI 接口。

独立只读代码复核没有发现阻止提交的问题。阅读内部窄屏布局、侧栏目录文字截断和原有设置焦点圈定机制不在本次重做范围。构建仍有原有 CSS Highlight、设置模块混合导入和较大分包提示，构建结果成功。

## 前后截图（1200×750）

| 页面 | 改动前 | 改动后 |
|---|---|---|
| 首页 | [截图](C:/Users/Ethan/Desktop/floders/vibe/Pudict/test-results/ui-soft-blue/before-home-1200x750.png) | [截图](C:/Users/Ethan/Desktop/floders/vibe/Pudict/test-results/ui-soft-blue/after-home-1200x750.png) |
| 翻译 | [截图](C:/Users/Ethan/Desktop/floders/vibe/Pudict/test-results/ui-soft-blue/before-query-1200x750.png) | [截图](C:/Users/Ethan/Desktop/floders/vibe/Pudict/test-results/ui-soft-blue/after-query-1200x750.png) |
| 生词本 | [截图](C:/Users/Ethan/Desktop/floders/vibe/Pudict/test-results/ui-soft-blue/before-vocabulary-1200x750.png) | [截图](C:/Users/Ethan/Desktop/floders/vibe/Pudict/test-results/ui-soft-blue/after-vocabulary-1200x750.png) |
| 设置 | [截图](C:/Users/Ethan/Desktop/floders/vibe/Pudict/test-results/ui-soft-blue/before-settings-1200x750.png) | [截图](C:/Users/Ethan/Desktop/floders/vibe/Pudict/test-results/ui-soft-blue/after-settings-1200x750.png) |
| 阅读（公共样式） | [截图](C:/Users/Ethan/Desktop/floders/vibe/Pudict/test-results/ui-soft-blue/before-reading-1200x750.png) | [截图](C:/Users/Ethan/Desktop/floders/vibe/Pudict/test-results/ui-soft-blue/after-reading-1200x750.png) |

全部多尺寸截图和浏览器验收记录保存在本地 `test-results/ui-soft-blue/`。

## 执行决定

沿用用户正在预览的工作目录，使用独立的 `codex/soft-blue-ui` 分支；便于实时检查，但工作目录不提供独立 worktree 的物理隔离。保留旧编号间距，避免阅读内部几何变化。仅本地提交，不执行 git push。

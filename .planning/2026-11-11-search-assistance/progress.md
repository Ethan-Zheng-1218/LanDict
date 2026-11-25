# Progress

2026-11-11：执行已确认的局部交互扩展，沿用brainstorming已批准方案，使用test-driven-development、shadcn、verification-before-completion；最后按requesting-code-review审查。

实现共享AssistedWordInput、最高词频前缀补全、160ms防抖、Tab/Esc/真实输入Enter/IME及竞态门禁；主页保持原Input和表单，翻译页复用同组件。唯一拼写候选使用本地词典解释，原输入保留，提供可点击纠正提示；多候选显示选择。正式纠错仅QueryPage opt-in，后台阅读查词不改变。AI等待词典结果后按纠正词调用一次。

只读审查指出两项问题并已修复：真实bnc/frq为REAL，原生改f64并以REAL fixture红绿验证；派生词库原来无word索引，新增ensure-dictionary-index幂等准备，dev/build及重建/沿用词库均接入，EXPLAIN实测SEARCH stardict USING COVERING INDEX stardict_word。

2026-11-12续接：Corepack的pnpm缓存下载失败，使用已安装依赖直接运行node node_modules/vitest/vitest.mjs run、typescript/bin/tsc及vite/bin/vite.js，不更改全局包管理器。最终全量513通过、2跳过；原生24通过、2忽略；tsc通过；Vite前端构建通过（原有CSS highlight和分包体积提示）。

预览服务1421已启动。浏览器首次导航超时但标签成功创建，绑定后完成实测：首页CAPT真实输入不变、灰色CAPTAIN，Tab接受成为CAPTAIN；cat右侧预览n.猫；captuer提交后保留原输入，显示“拼写可能有误，已为你显示 capture 的解释。”和capture释义。页面已留作交付。前次额度限制的审批失败已在续接后恢复。未打包、未推送。

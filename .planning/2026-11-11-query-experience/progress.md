# Progress

2026-11-11：开始执行已确认的五项查询交互优化，使用 test-driven-development、shadcn 和 verification-before-completion 工作流；实现后按 requesting-code-review 做只读审查。

实现 QuerySearchBox、definitionPreview、LookupText，复用现有存储/本地原子查询/正式resolveQuery。输入与详情分离、Enter和IME、重复提交刷新、历史选择、正文原拼写点击及拖选门禁均有测试。相关48项测试及tsc通过。首轮前端构建成功（既有CSS highlight/分包提醒）。

IAB实测 cat 显示 n. 猫，input右边界611、preview左边界623、button左边界669，互不重叠；preview pointer-events:none、user-select:none。capture Enter后原文保留、历史最新五条浮层与表单左右边界完全一致。点击历史break、例句routine均同步输入和查询。可点击正文与父级字体/颜色/行高/字距一致，padding为0、透明背景，仅cursor:pointer。只读审查发现并已修复Portal顶部遮挡，浏览器命中检测复验通过。

最终验证：完整 pnpm test 500通过、2跳过；pnpm build（含tsc）通过；git diff --check通过。原有路由100ms断言在测试与构建分开执行后通过，未修改路由代码。构建仍有既有的CSS highlight、settings分包及chunk体积提示。审查复核Portal修复后无新增实质问题。无新增依赖、无付费API；本地提交，不推送、不制作安装包。

# Findings

- 首页HomePage仍使用SearchBox+Input，翻译页QuerySearchBox已有精确预览。将提取共享AssistedWordInput，保留两边原有表单与布局。
- 本地精简ECDICT含bnc/frq词频，可给前缀候选排序；拼写生成单次插入、删除、替换及相邻交换候选，通过索引精确查找，避免全库模糊扫描。
- 新本地原子接口返回常用英文候选，Node/Rust均支持；UI仅显示一个补全词，不要求猜中用户意图。
- QueryPage的OptionalAiPanel原本立即按原输入自动调用；容错要等待词典解析后再按纠正词调用一次，避免原词和纠正词各调用一次。
- 保留用户未跟踪的安装包/图片/历史构建文件。本轮版本仍0.1.2，不打包。

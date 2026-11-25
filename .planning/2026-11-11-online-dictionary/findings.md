# Findings

- 原流程 resolveQuery -> createDictionaryApi -> dictionaryResolver；英文牛津精确/词形还原优先，ECDICT 兜底；中文反查独立。AI 卡片独立。
- Vite 和 Rust 已使用 https://dict.youdao.com/jsonapi?q=... 补美式音标。2026-11-11 实测 hello、tauri、ran 返回 200 和 ec.word[].trs，未知词没有 ec。
- 释义来自 ec；例句 blng_sents_part；搭配 phrs；不把网络释义或 AI 字段当成词典释义。
- 官方付费开放 API 仅赠体验金：https://ai.youdao.com/new/product-fanyi-text.s 。本功能只使用不需要 key 的公开网页词典入口，服务变更时自动本地回退。
- Firecrawl CLI 不可用，已使用 web 搜索和 Node 对有道域名直接验证。
- 初始工作区仅有安装包、图片等未跟踪用户文件；保留，提交只包含本任务文件。

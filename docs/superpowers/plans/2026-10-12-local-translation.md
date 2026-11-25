# Local translation implementation plan

> For agentic workers: execute inline with executing-plans; retain test evidence and perform one final review.

**Goal:** Windows安装后即可使用免费英语↔中文翻译，AI只由用户主动触发。
**Architecture:** Argos模型+CPU CTranslate2/SentencePiece私有Python辅助进程，Rust管理标准管道和生命周期，React本地provider与手动AI卡片分离。
**Spec:** ../specs/2026-10-12-local-translation-design.md
**Global constraints:** 本地失败不转AI；不制作安装包；不push；固定版本、许可证随资源分发。

## Task 1 — Runtime and native command

- [x] 先加Python输入/分段/JSONL/不联网与Rust方向/协议/超时/清理测试，运行确认缺实现而失败。
- [x] tools/local-translation/worker.py提供translate(text,source,target)，JSONL输入{id,text,source,target}输出{id,translation}或{id,error}；处理完整token分块，保留段落。
- [x] tools/prepare-local-translation.ps1准备固定Python、wheels、模型与许可证，生成target/local-translation；接入Tauri开发/构建前准备，不安装全局依赖。
- [x] src-tauri/src/local_translation.rs实现desktop_local_translate、资源路径、惰性子进程和60秒超时；父进程退出及异常均清理。
- [x] 运行Python回归、实际离线双向翻译和cargo test。

## Task 2 — Free default and explicit AI

- [x] 先写查询/阅读/共享service回归：配置API也只本地；旧aiEnabled=true不请求；展开才AI；本地失败不AI；旧结果不覆盖新查询。确认红灯。
- [x] localTranslationProvider经invokeWithAbort调用desktop_local_translate；resolveQuery/resolveTextQuery文本分支走本地。AI错误不改变本地状态。
- [x] 查询页、阅读选区和悬浮卡用手动AI面板，复用Card/Button；移除自动AI设置和调用，保留手动语境义和凭据/连接测试。
- [x] 设置说明免费本地英中与手动AI费用、关于页模型署名；历史标记本地来源。
- [x] 运行相关测试后全量pnpm test、pnpm build、cargo test；Tauri--no-bundle编译并检查资源可发现。

## Task 3 — Verify and deliver

- [x] 对最终worker的实际输入输出进行断网和进程退出验证，记录与初步实验不同的结果。
- [x] 一次独立最终代码审查并修正实际问题；检查git diff只含本次改动。
- [x] 本地commit，报告功能、质量限制和测试；明确没有制作安装包或上传。

## Decisions and evidence

- 2026-10-12：用户授权验证通过直接接入，且禁止打包；执行在当前无已追踪改动的工作目录，保留icon.png和setup/。
- 24条轻量推理样本通过进程内禁网，约31/133/225MiB RSS，0.45s新进程启动；完整Argos Python链存在Stanza兼容失败，采用相同模型的轻量推理栈。

- 最终验证：419项前端、20项Rust、9项Python测试通过；正式worker禁网24次翻译与父进程退出通过；cargo check --release、Tauri --no-bundle --debug通过。新增查询历史切换保护、阅读本地失败重试。
- 本次不执行安装/卸载/杀毒验收，不制作或上传安装包；现有旧安装包时间和大小未改变。

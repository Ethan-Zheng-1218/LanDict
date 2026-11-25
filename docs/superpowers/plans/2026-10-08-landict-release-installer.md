# LanDict 正式安装器实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已确认的原生动画窗口接入完整软件，并加入协议确认、自启、保留安装包及桌面快捷方式选项。

**Architecture:** 沿用 Tauri 2 官方 NSIS 2.12.0 模板的安装资源、WebView2、维护和卸载逻辑。独立 Rust/Win32 模块增加准备状态与协议阅读层；安装状态复用已验收场景。软件通用设置通过官方 autostart 插件读取与修改 Windows 实际自启状态。

**Tech Stack:** React/TypeScript、Tauri 2、Rust/Win32、NSIS 3.11、Tauri autostart。

**Spec:** 用户于本轮确认既有原生预览，并要求完整打包、通用自启开关、协议确认和三个安装选项；协议正文仍待确认。

## Global Constraints
- 保持 LanDict 0.1.0 和 com.pudict.desktop；保留原学习数据。
- 安装中仍用已确认的 730×583 画布、24 视频帧、固定地球及真实引擎进度。
- 新增自启设置是用户明确授权的软件主体改动；不修改其他业务。
- 默认不自启、保留本次安装 EXE、创建桌面快捷方式。
- 未同意协议不得开始；失败/取消不删除安装包。
- 仅本地提交，不 push。修改前检查点 0f70774。
- 协议未获用户确认前只能提供待审核构建，不能称正式交付。

## Review Focus
- 安装器设为自启后软件能读取；切换失败不能伪报成功。
- `/S` 无交互时须有明确协议同意参数，不静默跳过确认。
- 文件、快捷方式或注册失败不可显示 100%，不可删除安装包。
- 清理只针对本次运行的 EXE，不能误删安装目录或其他文件。
- 重装/卸载不清理学习数据；隔离环境不可用须明确报告。

### Task 1: 软件通用自启设置
**Files:** SettingsPage.tsx、AutostartSetting.tsx/.test.tsx、Cargo.toml、lib.rs、autostart capability、依赖锁。
**Interfaces:** Windows Run 项名称统一 LanDict；前端 isEnabled/enable/disable 使用官方插件，不在 localStorage 保存伪状态。
- [ ] 添加组件行为测试，先观察缺少自启控件的失败。
- [ ] 使用既有 settings-row/settings-switch 实现读取、切换、忙碌与错误状态。
- [ ] 初始化官方插件 app_name("LanDict")，只向 main 窗口授权三个命令。
- [ ] 运行相关测试、前端全量测试与 Rust 应用测试；通过后本地提交。

### Task 2: 正式 NSIS 接入及安装选项
**Files:** tauri 配置覆盖、windows/installer.nsi、原生 options 模块、安装包清理 helper、build-release.ps1。
**Interfaces:** 准备页返回 consent/autostart/keepInstaller/desktop；同意后进入真实 InstFiles；只完成全部安装操作才能成功。
- [ ] 保留官方升级识别、资源映射、WebView2 和快捷方式目标检查。
- [ ] 准备页显示协议链接和三个可选项；同意框默认未选，未选时安装按钮不可用。
- [ ] 卸载只删除安装文件/注册信息及本应用快捷方式，移除删除用户数据分支。
- [ ] 清理 helper 等待安装进程退出后删除明确的源 EXE；保留默认且仅成功才触发。
- [ ] 编译真实正式 payload 候选 EXE，验证模板/模块相关测试；本地提交。

### Task 3: 实际验证与交付
**Files:** docs/installer-release/README.md、build.json、verification.json、截图和实际录屏。
**Interfaces:** 正式产品 EXE 与独立 Windows 测试环境；候选协议须获得用户确认后才作为正式版本。
- [ ] 在独立 Windows 环境首次安装、运行与查词、开关自启、快捷方式、重装和卸载，验证学习数据保留。
- [ ] 检查失败/取消、保留与删除安装包两种选择，并保留真实证据。
- [ ] 实际 DPI 与物理尺寸模拟分开报告。
- [ ] 一次独立整体代码审查，修复重要问题后交付路径、中文简介和本地 commit。

## 当前阻碍
本机已找到 VMware 和加密 Windows 11 VM；只读检查表明 vmrun 需解锁密码，没有启动、解锁或改动该 VM。协议草稿准备后请求用户确认，其余独立工作继续。

# 原生 NSIS 安装器预览实现计划

> 执行方式：在当前会话按 executing-plans 完成。用户已确认原生 NSIS 方案和真实进度，要求自主推进，不再重复请求技术方案授权。

**Goal:** 交付真正运行 NSIS 文件解压的 Windows EXE 预览，保持最终参考图布局，并证明动画和真实进度绑定。

**Architecture:** 独立 Rust / Win32 DLL 在 NSIS 安装窗口中分层绘制；保留 InstFiles 原生进度控件作为数据源，成功事件切换完成姿态。预览仅向本工作区内专用目录提取测试文件，不安装产品、不触碰当前用户的学习数据。

**Tech Stack:** Rust 标准库、Windows GDI+ / Win32、NSIS、PowerShell、Node。

**Spec:** docs/installer-feasibility.md；本轮用户批准两项确认问题。

## Global Constraints
- 不修改软件主体 UI 或业务代码。
- 保持参考窗口约 730 × 583 的比例，无新增底部操作栏。
- 标题栏左上角用 icon.png；其他小羊保留既有形象。
- 进度来自 NSIS 原生控件；动画时钟不能产生进度。
- 每次完成修改后本地 commit，不 push。

## Review Focus
- 解压期间 UI 不阻塞，真实进度可能停住但动画持续。
- 提取失败不会切换成功或显示 100%。
- 关闭窗口和重复运行释放图像、计时器及子窗口资源。
- 不同 DPI 保持几何比例及完整显示。
- 测试 payload 仅写入专用预览目录。

### Task 1: 原生绘制与资源
Files: src-tauri/windows/installer-ui/Cargo.toml, src/lib.rs, src/model.rs, tools/installer/prepare-assets.ps1。
Interfaces: model::progress_percent(position, maximum, successful)；frame_index(elapsed_ms)；独立图层素材目录。
- [ ] 先写 model 测试：引擎零值、大文件停住、成功前上限99%、仅成功100%、24 帧、1 秒循环。
- [ ] 单独 Rust 测试编译运行确认缺少实现时失败；实现并转绿。
- [ ] 从指定 a–e.png、项目 icon.png 及新授权视频提取完整素材，处理外部背景，保存源出处。
- [ ] 实现 Attach / Complete / Destroy NSIS 插件入口、绘制和 DPI 处理。

### Task 2: 可重复构建的真实 NSIS 预览
Files: src-tauri/windows/preview.nsi, tools/installer/build-preview.ps1, installer build artifacts under src-tauri/target/installer-preview。
Interfaces: Attach(asset_dir, log_path, preview_scale, record)，Complete()，Destroy()；预览目录通过固定构建参数传入。
- [ ] 获取官方便携 NSIS，使用本机 MSVC 与 i686 Rust 构建插件。
- [ ] 编译仅包含真实词典测试文件的 NSIS EXE；保留标准 InstFiles 及其进度句柄。
- [ ] 记录实际完成事件，检查提取文件哈希与实际进度采样；失败路径不得产生成功事件。
- [ ] 用 computer-use 检查原生窗口，并保留真实截图。
- [ ] 视觉不符时修正图层坐标和边缘，重新运行受影响验证。
- [ ] 提交本地 Git，并说明仍待视觉确认及正式产品安装验证。

### 后续阶段
视觉验收后接入 Tauri 官方模板及正式 release payload，保持快捷方式、升级、卸载和数据保留规则。隔离 Windows 安装 / 启动 / 卸载测试仍是交付必要步骤，不用本预览代替。

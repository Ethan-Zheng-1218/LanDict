# LanDict 正式安装包（已完成打包与实机验证）

2026-10-09：正式 NSIS 安装包已构建并在本机完成真实安装、启动、卸载验证。软件主体 UI 与业务代码未改动，学习数据未被删除。

## 交付物

- 安装包：`src-tauri/target/release/bundle/nsis/LanDict_0.1.0_x64-setup.exe`，41,163,742 字节，SHA-256 `E3F68DBEB3B217B85261DE6116EAD925A6CF0DAE0CE48C79723E530A0897218E`（2026-10-09 视觉修订版）。
- 安装窗口截图：`prepare-page.png`（当前系统 100% DPI 实窗）、`prepare-page-scale150.png`（150% 物理尺寸模拟）、`release-window/frame-*.png`（正式 EXE 自绘缓冲帧）。
- 重复安装识别截图：`maintenance-page.png`（正式 EXE 检测到已安装的 LanDict 0.1.0，提供“添加/重新安装组件”与“卸载 LanDict”）。
- 完成状态截图：`done-state.png`；准备页：`prepare-page.png`；标题栏悬停：`hover-close.png`、`hover-minimize.png`。

## 2026-10-09 视觉修订

- **多尺寸图标**：`installer.ico` 原来只有 32×32 单尺寸，Windows 放大后模糊；`prepare-assets.ps1` 新增 `SaveIcon`，现在写入 16/24/32/48/64/128/256 共 7 个尺寸（小尺寸用 32bpp DIB + AND 掩码，128/256 用 PNG），EXE 与任务栏图标随之清晰。
- **标题栏**：去掉最大化方块，只保留最小化与关闭；两个按钮都有悬停高亮、按下反馈与阴影，鼠标移到上面会变成手型。实测状态日志：悬停关闭按钮 `hover=2`、最小化 `hover=1`、离开归零。
- **完成安装按钮**：成功状态在“开始安装”同一位置（544,530,126×34）绘制同形状按钮，点击后安装程序以退出码 **0** 关闭（实测 `closed-by-button=True exitCode=0`）。
- **地球旋转裁切**：旋转层裁到半径 95%，不再扫出棕色蜡笔圈；云层与淡出层保持在下方。
- **小羊**：整体下移 15 DIP，落脚处改为 84/66/48 三层小阴影；不再使用卧倒姿态，安装完成后小羊与地球继续动（`elapsed` 不再在成功时冻结）。
- **进度条**：下移到 `y=508`，完全落在下方浅色面板内，不再压蓝白交界；100% 时填充正好到轨道内边缘。
- 测试结果：`verification.json`。
- 仅用于验证的隔离产品包：`LanDict Installer Test_0.1.0_x64-setup.exe`（产品名与安装位置独立，避免影响正式安装）。

## 安装界面与选项

准备页采用用户确认的排版：第一行“我已阅读并同意《软件使用协议》”，第二行并排“开机自启 / 保留本地安装包 / 创建桌面快捷方式”，右侧为“开始安装”。协议必须勾选后按钮才可用，协议可在窗口内完整阅读。默认值：开机自启关闭、保留安装包开启、创建桌面快捷方式开启。

安装中沿用已确认的 730×583 场景：24 帧小羊奔跑、固定圆心地球旋转、前景云层遮挡、真实 NSIS 引擎进度；只有安装成功才显示 100%。卸载界面不再提供“删除应用数据”选项。

## 已实测通过（本机真实执行）

使用隔离产品名的测试包执行，模板与逻辑和正式包一致：

| 场景 | 结果 |
| --- | --- |
| 静默安装（同意协议、自启开、保留包、桌面快捷方式） | 退出码 0；主程序、三份词典、卸载程序全部落盘 |
| 注册与快捷方式 | HKCU 卸载项、桌面快捷方式、开始菜单快捷方式、`HKCU\...\Run\LanDict Installer Test` 全部创建成功 |
| 卸载 | 安装目录、卸载项、两个快捷方式、自启项全部清除；`com.pudict.desktop` 学习数据保留 |
| 未同意协议即静默安装 | 退出码 2，未创建任何文件（协议不会被静默跳过） |
| 自启关、桌面快捷方式关、不保留安装包 | 退出码 0；未写自启项、未建桌面快捷方式、开始菜单仍在；安装包 EXE 安装成功后自删 |
| 重复安装（本机已装 0.1.0） | 正式 EXE 正常启动并显示中文维护页，可选择重新安装或卸载，未覆盖或改动现有安装 |
| 视觉修订版重跑 | 三条流程全部通过（`verification.json` ok=true, failures=0） |

本机已安装的正式 LanDict 程序启动验证：进程持续运行、窗口标题 `LanDict`、工作集约 60 MB。

自启一致性用与应用相同版本的 `auto-launch 0.6` 读取注册表验证：`LanDict` → `is_enabled=true`（安装器写入的项被软件开关识别），换一个名字 → `false`，说明该检查能区分，不是恒真。

单元测试：安装器清理助手 2/2、原生动画模型 4/4 通过。此前一轮前端全量测试 494 项、Rust 应用 16 项亦通过。

## 未完成或未验证

- 未做真正的隔离虚拟机测试：本机 VMware 中的 Windows 11 虚拟机启用了加密，需要密码才能启动；未在对话中索取密码，也未修改该虚拟机。上表均为本机真实执行结果，不是干净环境结果。
- 未验证真实 125% / 150% / 200% 系统缩放（本机 DPI 96）；`prepare-page-scale150.png` 是用 `/SCALE=150` 做的物理尺寸模拟，不能等同真实 DPI 测试。
- 未验证目标机缺少 WebView2 时的联网补装路径（本机已有 WebView2）。安装包按 Tauri 默认使用下载式引导，首次安装可能需要联网。
- 安装包**未做代码签名**（`Get-AuthenticodeSignature` = `NotSigned`），Windows SmartScreen 可能提示“未知发布者”。正式对外分发前建议购买并配置签名证书。
- 未验证多用户/管理员安装模式：当前固定为 `currentUser`，安装到 `%LOCALAPPDATA%\Programs\LanDict`，不请求管理员权限。

## 复现方式

1. `pwsh -File tools/installer/build-release.ps1`（完整构建，含 release 程序与安装包）。
2. `pwsh -File tools/installer/build-release.ps1 -SkipAppBuild -TestPackage`（隔离产品名测试包）。
3. `pwsh -File tools/installer/verify-install.ps1 -Setup <安装包> -ProductName 'LanDict Installer Test' -BundleIdentifier com.pudict.desktop -SkipAppLaunch`（自动完成安装/卸载/失败场景验证并输出 JSON）。
4. `pwsh -File tools/installer/capture-window.ps1 -Executable <安装包> -Output <png>`（抓取真实安装窗口；只截图，不点击安装）。

安装包受“保留本地安装包”选项控制：若取消勾选，安装成功并关闭窗口后本次运行的 EXE 会被删除；失败或取消时始终保留。

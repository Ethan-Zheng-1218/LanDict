# 开发说明

LanDict 使用 React 19、TypeScript、Vite 5 和 Tauri 2，桌面原生部分使用 Rust。当前开发环境为 Windows。

## 环境

- Node.js 22.13 或更高版本，需提供内置 `node:sqlite`；项目当前依赖若声明更高 Node 版本要求，以依赖要求为准。
- pnpm；当前工作环境使用 pnpm 12。
- 桌面开发另需 Rust、Visual Studio C++ 构建工具、Windows SDK 和 WebView2。
- 准备本地翻译资源需要联网和可分发的 x64 Visual C++ 运行库。

## 启动前端

```powershell
git clone https://github.com/Ethan-Zheng-1218/LanDict.git
cd LanDict
pnpm install
pnpm dev
```

打开终端显示的本地地址，默认是 `http://127.0.0.1:5173`。网页模式适合界面预览，桌面取词、原生保存对话框及部分本地功能依赖 Tauri，网页预览不能替代桌面验证。

## 启动桌面开发环境

```powershell
pnpm tauri dev
```

该命令会先执行 `pnpm prepare:translation` 准备本地翻译资源，再启动 Vite。首次准备需要下载运行环境、依赖和模型；如果找不到 Visual C++ 运行库，可按脚本参数指定路径：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/prepare-local-translation.ps1 -CrtDirectory "C:\path\to\x64\Microsoft.VC143.CRT"
```

## 词典与资源

仓库不包含所有运行时词典数据库、翻译模型和构建缓存。`data/ecdict-sqlite-28/stardict-slim.db`、`data/oxford-sqlite/`、`data/cedict-sqlite/` 等资源由忽略规则排除，因此干净克隆不能直接等同完整安装环境。

`tools/build-dictionaries.mjs` 可用于构建其支持的词典数据，使用前请检查所需输入及相应数据的授权。缺少本地词库时，网页预览的输入提示和离线查询会受限。普通用户建议使用 Releases 安装包。

## 目录

- `src/app/`：应用框架和路由。
- `src/features/`：查词、阅读、生词、背词及设置功能。
- `src/lib/`、`src/components/`：公共逻辑和组件。
- `src-tauri/src/`：桌面命令、取词、阅读抓取、翻译和文件导出。
- `tools/`：词典处理、翻译准备和安装器工具。
- `docs/`：用户指南、发布说明及历史设计资料。

浏览器插件是独立项目，不从该仓库构建。

## 检查与测试

```powershell
pnpm test
pnpm exec tsc --noEmit
cargo test --manifest-path src-tauri/Cargo.toml
```

前端单文件测试可使用 `pnpm exec vitest run <测试文件路径>`。修改公共组件、路由、全局状态、数据层或共享工具时，按项目规则运行全量测试；局部修改运行直接相关检查。

## 安装包构建

日常开发不需要生成安装包。需要发布新版时，先同步 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json` 的版本，并准备完整运行资源，再运行：

```powershell
pwsh -File tools/installer/build-release.ps1
```

安装器脚本会校验版本一致性及版本是否重复。新构建必须递增版本，并在实际安装后从设置“关于”核对版本。历史安装器实验见 [installer-release](installer-release/README.md)，其中旧版本测试记录不代表当前版本已重复执行同样的验证。

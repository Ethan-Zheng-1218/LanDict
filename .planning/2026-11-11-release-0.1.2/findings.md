# Findings

- 当前分支codex/soft-blue-ui，前两项功能已提交5880153/51ddb44。git remote为空；用户说明通过VS Code源代码管理，按本地提交继续。
- 设置页直接从package.json导入版本，当前应随构建显示0.1.2，不是写死的UI文案。
- 正式打包入口tools/installer/build-release.ps1；现有美术素材及本地翻译资源齐全，复用-SkipAssets，不跳过应用编译。
- 旧0.1.0和0.1.1安装包保留。verify-install.ps1会卸载测试安装，不用于用户现有应用更新。
- 原安装位置D:/Program Files (x86)/landict.exe，更新前文件版本0.1.1。
- 已安装0.1.2到原位置，原有查询历史及设置仍可见。界面关于页实测显示0.1.2。
- 用户开启了配置好的AI自动翻译，本次安装验证未触发新的正式查询，避免额外AI调用；本轮功能的完整500项测试已在上次提交验证。

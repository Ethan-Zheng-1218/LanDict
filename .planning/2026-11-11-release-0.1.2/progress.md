# Progress

2026-11-11：同步package.json、Cargo.toml、Cargo.lock、tauri.conf.json版本0.1.2；发布脚本增加四处版本一致性和重复安装包版本保护，AGENTS记录今后发布要求。

验证：SettingsPage16项测试通过；build-release保护测试2项通过，证明版本冲突/重复版本在编译前被拦截。正式前端和Rust release编译通过，NSIS包生成成功（201.61MiB）。首次NSIS工具缓存写入受沙箱限制，提升权限后完成；重试时已有bundler标记提示不影响安装结果。原先CIM查询不可用，改为Get-Process与32位注册表精确确认安装路径。

安装：桌面副本SHA256=74DAA11AED955C7287B1223E39B0E834FD5D778837D118974C4432BE0C24F3A6，与构建原件一致。原目录静默更新exit0，已安装exe文件版本0.1.2且SHA256与release产物一致。通过computer-use打开已安装软件，关于页文字及截图显示0.1.2，首页原有历史仍存在。未更改用户AI设置。保留旧安装包，未创建或推送远程仓库。

交付：C:/Users/Ethan/Desktop/LanDict_0.1.2_x64-setup.exe；原产物C:/Users/Ethan/Desktop/floders/vibe/Pudict/src-tauri/target/release/bundle/nsis/LanDict_0.1.2_x64-setup.exe。

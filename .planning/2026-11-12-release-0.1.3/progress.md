# Progress

2026-11-12：同步四处版本；相关SettingsPage及release guard共18项测试通过。调用正式build-release.ps1 -SkipAssets完整编译、打包。

正式前端、Rust release和NSIS构建通过；安装包201.94MiB，旧包保留。桌面和原包SHA256一致：0F9752B93740F39D457C7CCEADAEC1DC17E3B052CE471DF1D219AE8DE105A109。

原目录 D:/Program Files (x86) 更新成功，ProductVersion/FileVersion均0.1.3。最初严格二进制哈希比较触发差异；逐字节核实仅3字节的Tauri bundle标记（安装包为NSS，bundle结束后的release原件恢复UNK），只归一化此预期标记后其余字节完全一致。安装版SHA256=70ea8a5440e9d9e6cc611e46397cb1d6937e1a75ed4af852d1e5a1b0aad0ad78。

已启动安装版并通过computer-use实测首页CAPT出现灰色AIN与船长预释义，原有历史仍在；关于页截图确认0.1.3。未提交测试查询、未调用AI。交付桌面副本并本地Git提交，不推送。

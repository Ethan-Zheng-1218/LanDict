# Findings

- 当前安装 D:/Program Files (x86)/landict.exe，版本0.1.2。
- 设置从package.json读取版本，四处发布元数据同步为0.1.3。
- 复用已有原生安装器素材，仍完整重新编译应用，词典索引由beforeBuild准备。
- 只更新当前安装，保留旧包与用户数据；不运行会卸载的verify-install流程。

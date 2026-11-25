# 检查发现

详细结论与官方来源：docs/installer-feasibility.md。
素材尺寸、PNG 格式及哈希：docs/installer-asset-inventory.json。

- 用户确认 Desktop/design ui/07安装包 是唯一原始素材目录，只有 a–e 五张 RGB PNG。
- 旧 HTML 有六张不同的 RGB 小羊帧，以及 RGBA 品牌、字标、勾号和云层；内嵌地球与 b.png 哈希不同。
- NSIS InstFiles 安装过程使用工作线程；默认进度是指令进度，不能声称逐字节精度。
- 可通过安装器专用原生绘制层处理 alpha、旋转和帧动画，尚未运行验证。
- c.png 的 0% 与非空蓝条冲突，必须确认如何以真实进度为准。
- 未找到 release 安装包或已验证的隔离安装测试环境。

本文件是检查数据和结论记录，不授权任何安装或 UI 妥协。

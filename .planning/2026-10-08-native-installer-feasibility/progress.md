# 本轮进度

2026-10-08：检查点 commit 9def170。没有修改应用代码。
已保存技术评估和素材清单；下一步等待用户确认 NSIS 原生绘制模块及进度条一致性。

工具情况：planning-with-files 初始化脚本无法通过沙箱路径核验，因此手动建立已核对在本工作区内的独立任务目录，没有改动其他任务的 active pointer。tauri info 未返回，已终止；未计为成功检查。

本轮验证：文档差异检查，素材清单与源图、旧 HTML 的 PNG 数据重新比对。没有执行产品测试、构建、安装或卸载。

后续实现进度：已编译 32 位 Rust 原生 DLL 和真实 NSIS 预览，三份词典成功提取；预览 EXE 在 src-tauri/target/installer-preview/LanDict-native-preview.exe。原生 UI 使用 computer-use 的 @oai/sky 检查。初版发现渐变 WrapMode=Clamp 不支持、默认 onInstSuccess 等离页才发生；已改为 Tile，并监听 InstFiles 的 WM_NOTIFY_INSTPROC_DONE，尚待最终版本完整复测。

用户两次修正：只允许从 Desktop/design ui/07安装包 取源素材（icon.png 另有明确授权）；拒绝旧 HTML 羊帧，随后也拒绝从 a.png 拆分肢体的动画。已关闭旧预览，移除旧素材打包路径。下一步必须使用新生成的完整姿态帧，禁止恢复 Rig / 部件旋转。内置 imagegen 已只参考 a.png 生成 src-tauri/windows/installer-assets/sheep-run-sheet.png。

用户指出地球晃动：必须固定圆心与外轮廓，只旋转内部区域，同时保留场景底部裁剪和云遮挡。当前正修改，未重新构建最新改动。当前预览均已关闭。

最新用户流程取代之前的直接预览迭代：停止现有界面零碎修改，优先专业工具核实和完整四足动作设计。已调用 find-skills 的 CLI、plugin-management 的搜索、CDB 健康检查，实测 Pillow 12.3.0 / WebP。UI/UX Pro Max 从真实 GitHub 下载并读取，已执行两个 UX 搜索。Runway 查到但未启用，不能声称有 AI 视频。详见 docs/installer-animation-restart.md。

新十二帧草图因前后腿关系不清楚未通过自审，未组装或安装。已改为先锁定完整四足基准角色，保存 docs/installer-animation/master-pose.png，实际 PNG 解码及 alpha 验证通过。四足基准稿还未获用户视觉确认，下一步以此确认固定形象后再推进循环。原生预览已关闭；不恢复旧素材和拆分肢体方案。


## 最新：视频原生预览及用户逐项视觉修正
24帧视频素材已实际进入NSIS窗口。灰线来自完成态裁图的地球/蓝底残留，已仅清除透明遮罩；完成态y=259，跑步整体+5并有柔边阴影。固定地球内伸残片由外圈遮罩带入，已限制为原画外圈并删除静态大陆底层。用户授权重新设计进度条，采用b.png海洋水彩纹理、浅蓝底槽和连续云层渐变。非整数尺寸的渐变采样与矩形接边细线经原生GDI探针定位，使用双轴镜像和单次连续渐变修复。
成功引擎事件与三文件哈希、故意失败93%不冒充100%、关闭退出码0/1及取消销毁均已核实。Rust模型4项通过。独立代码审查发现录制API前提错误，改为移出DC后读取DIB像素；录屏编码在UI线程之外。
目前桌面其他应用Armoury Crate安装/UAC提示遮挡窗口，输入工具曾返回权限拒绝；未操作提示，已请求用户自行处理。当前DPI96，125尺寸模拟已看，150/200保留完整本窗口绘制缓冲区，不声称真实系统DPI测试已全部通过。交付候选与验证见docs/installer-preview，正式产品安装验证尚未开始。

# 当前小羊动画素材：直接从用户视频提取

用户最新指示：直接使用 `C:/Users/Ethan/Downloads/豆包 (2).mp4`，从中摘取关键帧，帧数自行判断。本轮不再生成、重绘或拆分小羊；视频是用户明确授权的新素材来源。

当前审查稿是 [video-run/preview.gif](video-run/preview.gif)，**24 张完整角色帧、1 秒循环**。素材、选段和验证详情见 [VIDEO-EXTRACTION.md](VIDEO-EXTRACTION.md)。透明 PNG 位于 `video-run/frames/`，透明 Sprite Sheet 和动画 WebP 同时保留，供 NSIS 原生绘制读取。

GIF 的浅蓝底只用于观看。生产 PNG 保留透明通道，去除纸面背景和地面阴影；所有帧使用同一个裁剪范围，没有单帧重新居中或添加整图跳动。小羊的可见颜色像素直接来自原视频，包括它原有的脚部轮廓。

`doubao-run-*` 是此前未通过验收的 AI 重绘稿，已被本次直接提帧方案替代；`master-pose.png`、`soft-feet-pose.png` 和 `free-wan-reference.*` 也只是历史探索，不用于当前小羊素材。

当前完成的是可供安装器使用的动画素材和动作预览；尚未确认安装界面视觉，也未完成正式安装包及隔离安装、启动、卸载验证。后续采用本次视频帧，不沿用旧 HTML 帧、拆分肢体稿或 AI 重绘稿。

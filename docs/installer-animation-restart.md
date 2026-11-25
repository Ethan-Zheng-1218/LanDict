# 安装器设计与小羊动画重新制作

**最新有效决定（2026-10-08）：** 用户明确指示直接从 `豆包 (2).mp4` 摘取素材，帧数自行判断。已完成源帧 14–37 的 24 张透明完整角色帧、1 秒循环；本轮没有重绘。当前成果见 `docs/installer-animation/VIDEO-EXTRACTION.md` 和 `video-run/preview.gif`。以下工具选择与动作设计为历史探索，其中 imagegen 重绘、12 帧 0.96 秒路线已被替代。保持先审查动画/设计，再接入原生安装器预览及正式安装验证的流程。

2026-10-08。用户明确否定当前视觉效果，要求先做工具核实和设计验证。现有原生预览已经关闭；旧八帧、拆分肢体方案和现有预览均未获视觉验收，不是正式安装器交付。

## 已核实的工具及选择

- **CDB / start-design**：现有已安装技能，后台版本 0.9.0+codex.20260829100031，健康检查成功。适合可审查的设计板和视觉对照；在动作通过后使用它审查安装界面布局。当前没有活动设计项目。
- **imagegen**：当前可调用的内置图像生成工具，已实际使用。能依据 a.png 绘制完整姿态和透明 Sprite Sheet；不能生成视频，也不能代替四足步态、角色一致性和循环的人工审查。
- **Pillow 12.3.0**：本机捆绑 Python 实测可导入，WebP 支持可用。用于整帧排版、GIF / WebP 组装、解码检查和首尾对照；不用于把原画的腿拆下来运动。
- **UI/UX Pro Max**：不是预装技能。本轮从真实上游 https://github.com/nextlevelbuilder/ui-ux-pro-max-skill 获取并读取完整 SKILL.md，版本提交 15cc30a393ecb34cd217d21bc4ffdb1f5414b0ca，MIT。工具放在 Git 忽略的 `.superpowers/skill-tools/ui-ux-pro-max`。已真实执行其本地 search.py，分别检索持续动画 / 晕动敏感和加载进度反馈。结果适用于整体 UX 审查；其中 Web 媒体查询及 ARIA 例子不能照搬为 NSIS API。
- **NSIS 3.11、Rust / Win32、computer-use**：现有工程验证工具。NSIS 官方包已按 Tauri 上游 SHA-1 核对；原生窗口已经运行，但现阶段停止继续打包，等待设计与动画验收。
- **Runway**：2026-10-08 插件已安装并连接。实际调用账户能力检查确认 authenticated=true，但当前 Free 工作区 availableVideoModels=[]，无法生成视频。已调用套餐展示工具呈现“Generating video”限制；没有提交视频任务，也没有订阅或购买。等待用户选择继续完整姿态逐帧动画参考，或自行开通视频权限后制作 2–3 秒 AI 动作参考。
- **Pencil2D / OpenToonz**：通过官方 GitHub 核实的开源 2D 手绘动画编辑器；本机常见安装目录未发现，也没有声称调用它们。可用于人工重绘和逐帧精修备选。
- **FFmpeg / Blender / Inkscape / gifski / Aseprite**：当前 PATH 未发现；不把它们记为已安装。
- **ComfyUI / Wan2.2**：官方 GitHub 有公开方案，但本机未发现已配置推理环境，捆绑 Python 没有 torch。本轮不为短动作参考直接引入大型模型部署。

Skills CLI 实际检索了 `2d animation`。结果包含 SpriteKit、PixiJS、像素 Sprite、角色 Rig 等技能，但平台 / 风格与水彩小羊及 Windows 安装器不符，未调用或安装这些候选。

当前选择：**UI/UX Pro Max 审查约束 + imagegen 完整姿态绘制 + Pillow 动画审核；CDB 在动作通过后审查界面；NSIS 在设计验收后承载真实安装**。Runway 已连接但当前没有视频权限，逐帧动画与 AI 视频应明确区分，不能声称生成了 AI 视频。

最新选择已调整为免费路线：已实际调用 Hugging Face ZeroGPU 的 Wan2.2 演示，完成两段约 2.56 秒 AI 动作参考并逐帧审查。第一段保存为 `docs/installer-animation/free-wan-reference.mp4` / `.gif`，仍不是已验收循环。ComfyUI + Wan2.2 本地工具作为后备，当前下载 / 环境未完成；详见 `docs/installer-animation/FREE-VIDEO.md`。不再继续 Runway 付费路线。

来源：[UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)、[Pencil2D](https://github.com/pencil2d/pencil)、[OpenToonz](https://github.com/opentoonz/opentoonz)、[ComfyUI](https://github.com/Comfy-Org/ComfyUI)、[Wan2.2](https://github.com/Wan-Video/Wan2.2)。

## 小羊动作设计草案

原画 a.png 是静态角色参考，不是动画帧。保持其头部、羊毛、两只眼睛、耳朵、粉色脸颊、棕色蜡笔纹理和整体比例。只从用户指定素材目录取角色和场景参考；标题图标仍按用户单独授权用 icon.png。

最新视觉要求：小羊是简笔画，不能为了表达四足而画清晰脚掌、鞋状脚底或关节。腿部用羊毛下缘的浅桃色笔触和遮挡暗示；伸展和交替需要体现在完整姿态中。`docs/installer-animation/soft-feet-pose.png` 是此方向的静态审查稿，尚未视为动画验收通过。

选用轻快四足小跑：对角腿交替支撑。近前腿与远后腿为 A 组，远前腿与近后腿为 B 组。前 / 后肢位置固定在同一身体结构上；同一视角下远侧腿可以部分遮挡，但不能突然多出腿、变成手臂或改变脸型。

参考依据：四足小跑采用对角配对运动，步态中需要区分支撑与摆动；不把羊的走路支撑时间直接当作跑步动画参数。见 [比较四足与两足运动的研究](https://pmc.ncbi.nlm.nih.gov/articles/PMC5614437/)及[步态动力学综述](https://pmc.ncbi.nlm.nih.gov/articles/PMC7805771/)。研究检索用于运动规律，本角色的时间和幅度仍是待审查的动画设计值。

初始草案为 0.8 秒循环。用户后来提供 `豆包 (2).mp4` 作参考，经逐帧查看，当前审查稿调整为 0.96 秒循环、12 个完整姿态，固定镜头、朝右、轻微三分之四视角。详见 `docs/installer-animation/DOUBAO-REFERENCE.md`；尚未通过视觉验收。

1. A 组接触地面；B 组收回准备前摆。
2. A 组承重，关节轻微压缩，身体降低少量。
3. A 组向后伸展蹬地；B 组向前伸展。
4. A 组脚尖离地；B 组准备落脚。
5. 短暂腾空，四条腿自然收拢，头部稳定。
6. B 组落脚；A 组进入恢复阶段。
7. B 组承重并压缩。
8. B 组向后蹬地；A 组向前伸展。
9. B 组离地，A 组准备接触。
10. 短暂腾空，四肢恢复到下一次接触之前的姿态。
11. A 组接近落脚，身体回到接触高度。
12. A 组接触前一刻，与第 1 帧连接。

身体起伏应由支撑转换产生，不能仅让原画整体弹跳。完整角色每帧重绘，禁用现有拆分 / 转动肢体方案。头部与身体允许自然运动，但大小、脸型和视角必须锁定。

## 动作设计验收

- 正常速度：观看 2.4 秒，辨认对角腿支撑和摆动，不是四肢随意摆动。
- 慢速及逐帧：确认四条腿的连接、前后与远近关系，检查脚在承重期是否滑动、飞离接触面。
- 身份对照：与 a.png 并排比较脸型、眼睛、腮红、耳朵和羊毛。不能只检查“像一只羊”。
- 首尾对照：最后一帧接回第一帧，观察姿态和速度；文件编码测试不能替代肉眼审查。
- 不通过时修正姿态，不能把未验收帧继续塞入安装器。

通过角色动作后，再审查地球、云层、标题、Logo 和进度布局。地球圆心与外轮廓固定，无整体偏摆，下半部受场景边界和前景云遮挡；进度仍来自真实安装引擎。界面视觉通过后才进入正式 EXE 和隔离安装 / 卸载测试。

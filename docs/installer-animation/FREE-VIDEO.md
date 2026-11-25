# 免费动作参考（未验收）

2026-10-08 用户要求使用免费资源。实际选择免费 Hugging Face ZeroGPU Wan2.2 演示，已完成两次公开接口生成；没有使用 Runway 生成视频，没有订阅、购买或付费 API。

## 已完成的参考

- `free-wan-reference.mp4`：第一次生成，640×640，16 fps，41 帧，2.5625 秒。全部帧可正常解码，41 帧内容不同。
- `free-wan-reference.gif`：由整段视频帧重新编码，可直接播放。按 GIF 的 10ms 精度分配帧时长，合计 2.56 秒。
- `free-wan-contact.png`：等间隔抽取 12 帧用于逐帧审查。
- `free-wan-prompt.txt`：实际正负提示词。

只上传并使用用户目录中的原始 `a.png`。原画没有修改，没有读取旧 HTML 的动画库。视频帧都是模型预测的完整角色姿态，没有切下四肢或旋转身体部件。第二次生成增加了脚部简化约束，但动作后半段变弱，未选作交付参考。

原画 SHA-256：`13039b8b8902df50925532e5a830f7a8a156c90cd6b86ea26bd9d1ce208ca0b2`。

实际运行服务：[zerogpu-aoti/wan2-2-fp8da-aoti-faster](https://huggingface.co/spaces/zerogpu-aoti/wan2-2-fp8da-aoti-faster)。检查时运行版本 `1ff7432a88d7827eb787ef10c15cbc5c85c841a2`。第一次任务 `b3f7909786fa47e19bd1c59d1f798498`，seed 4208，4 steps，请求时长 2.5 秒；第二次任务 `3f9c5c3386a54841b2560c55b7ed5012`，seed 4209，6 steps。实际调用公开的 `generate_video` 接口并取得 complete 结果；这不是仅找到资源链接。

## 视觉审查结论

第一版有腿部伸展和收回，可作为运动研究参考；脸、耳朵和羊毛基本保持同一角色。仍未达到安装器动画标准：腿部还有明显棕色轮廓，原画蜡笔细节被简化，第一帧和最后一帧姿态不同，四足的远近与支撑关系还需进一步修正。GIF 设置循环播放不意味着已经无缝循环。

这些文件只供动作参考，不是最终透明帧、Sprite Sheet 或已批准的安装器资产。没有接入原生安装器，也没有构建新安装包。下一步应以原画身份、浅色腿部笔触和正确四足步态制作完整姿态循环，再进行设计验收。

## 免费方案与实际状态

**Wan2.2 + ComfyUI 本地运行**：Wan2.2 为 Apache-2.0，ComfyUI 为 GPL-3.0。只作为独立素材制作工具，不加入 LanDict 应用运行依赖。检查到本机 RTX 5070、12,227 MiB 显存、约 32GB 内存；[ComfyUI 官方流程](https://docs.comfy.org/tutorials/video/wan/wan2_2)说明 5B 可通过内存卸载适配 8GB 显存。已克隆官方 ComfyUI 到忽略的独立工具目录，取得官方 5B 工作流。第一次大文件下载中，两个模型连接中断，PyTorch 包校验失败，本地运行环境尚未完成，不能声称本机已经生成视频。现已通过免费在线演示取得实际参考，本地环境保留为后备，未关闭文件校验或把不完整模型改名为完成文件。

**Hugging Face ZeroGPU 免费在线运行**：本次已实际使用。公开演示仍可能排队或受额度限制，不作为安装程序运行时依赖。[ZeroGPU 官方说明](https://huggingface.co/docs/hub/spaces-zerogpu)。

**LTX-Video**：已核实官方支持图生视频、小模型与 ComfyUI 流程，是后备免费模型候选，本次未运行。[官方仓库](https://github.com/Lightricks/LTX-Video)。

Runway 保留连接，但不再作为本任务的主要制作路线。

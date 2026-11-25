# LanDict 英中本地翻译可行性报告

日期：2026-10-12。结论：推荐方案 A，捆绑 Argos 发布的英语↔简体中文模型、Python 私有运行环境和 CTranslate2 推理辅助进程。验证通过后直接接入已获用户授权；本次不制作安装包、不上传、不 push。

## 当前流程与产品目标

查询页的短语/文本 effect 和阅读页的选区翻译此前直接请求 AI。单词使用本地词典，但设置中的自动 AI 开关以及桌面悬浮取词仍有自动 AI 入口。AI provider 支持 DeepSeek、OpenAI 和兼容接口，Tauri 通过 Rust 的 desktop_ai_request 发起 HTTP 请求，开发网页使用 /api/ai-translate。接口配置完整即被视为可用，enabled 字段不是费用开关。

最终行为统一为：单词查现有词典；短语、句子、段落自动显示本地译文；AI 卡片初始折叠，用户明确展开后才发送 AI 请求。设置了 API 或保留了旧自动 AI 设置都不能自动请求。失败、缺模型、超时、离线均不能转 AI。保留 API 服务设置和现有单词语境义；中文一至两个汉字仍按现有词典反查规则处理。初期只支持 en↔zh。

当前发布采用自定义 NSIS 模板、currentUser 安装和 LZMA 压缩；旧安装包 41,174,318 字节（39.27 MiB）。主窗口关闭会隐藏到托盘，辅助进程应在真正退出时终止。

## 方案比较与推荐架构

- **A：运行环境和两个模型全部随安装包分发，推荐。** 安装后不用配置、不用另外装 Python、不用启动服务、不用首次下载。体积是主要代价。
- **B：只捆绑环境，首次启动下载模型。** 能减少最初下载量，但首次离线不可用、下载失败时不可用，不满足核心要求，不作为默认产品方案。
- **C：用户另行运行 LibreTranslate。** 还要维护服务、模型和端口；不满足开箱即用，也不能提高同一模型的翻译质量。不纳入本次实现。

数据流：React 查询分类 → 单词走现有词典；非单词经 Tauri command → Rust 管理唯一按需启动的子进程 → 私有 Python → 本地断句 → SentencePiece → CTranslate2 CPU/int8 → 同方向 Argos 模型 → JSONL 标准管道返回译文。另一路 AI 仅从明确的手动操作进入现有 provider；两路不互相兜底。进程不监听 HTTP 端口。

优先评估了完整 Argos Python 库：1.10.0 的全依赖环境实际约 806 MiB，旧模型中 Stanza resources.json 与 Stanza 1.10.1 出现 packages 错误，指定 tokenizer 后又出现 feat_dropout 模型参数错误；导入完整栈首次约 14.4 秒，后续新进程约 4.5 秒。1.11.0 还引入 AGPLv3 MiniSBD。因此不直接把完整 pip 环境塞进 LanDict。

采用**同一 Argos 模型和原有 CTranslate2/SentencePiece 推理核心的轻量辅助进程**，而非完整 argostranslate.translate API。英文用 MIT 的 PySBD 规则断句，中文按句末标点断句；长句按 token 分块，处理全部输入，不静默截断。移除 Stanza/Spacy/PyTorch/MiniSBD 不更改翻译权重，但断句差异会影响复杂文本。这是经验证后的明确架构调整。

## 模型、体积与 Windows 分发

官方索引提供两个直接模型，无需借助第三语言：

- translate-en_zh-1_9.argosmodel：70,743,021 字节，67.47 MiB；解压 85,640,765 字节。
- translate-zh_en-1_9.argosmodel：74,481,402 字节，71.03 MiB；解压 86,137,496 字节。
- 合计下载 138.50 MiB，完整解压 163.82 MiB。两包各自包含 SentencePiece、模型权重和旧 Stanza 断句数据。轻量方案不分发不使用的 Stanza 数据。

Windows x64 采用官方 CPython 3.12.10 embedded ZIP（下载 10.62 MiB，完整解压 21.46 MiB），构建时把固定版本 Windows wheels 解压到私有 deps，设置 ._pth；用户电脑不用 pip、不修改全局 PATH、不注册系统 Python。推理固定 CPU，不要求 CUDA 或 NVIDIA 显卡。CTranslate2 4.8.2 Windows x64 wheel要求 SSE4.1 和 Visual C++ runtime；所需可再分发 CRT DLL随私有目录提供，不能依赖开发机已经安装的 Visual Studio。

轻量验证目录含测量工具外的环境与完整两模型共 302,793,841 字节（288.77 MiB），连续 LZMA 压缩实测 170,441,808 字节（162.55 MiB），**不是安装包**。加旧安装包估算约 202 MiB；正式 NSIS 安装包暂按 **200–230 MiB 总体积，增加约 160–190 MiB** 预算。正式体积须在用户要求打包时才能确认，本次不生成 setup.exe。安装占用额外约 290 MiB，安装过程还需临时空间。

完全断网安装和“安装完成后的断网翻译”不同：当前 Tauri 默认会在缺 WebView2 时联网安装它；若未来要求无 WebView2 的全新电脑也能断网安装，可选捆绑 WebView2 offline installer（Tauri 文档估计增加约127 MB）。本次不擅自改变这一安装取舍。

## 性能和译文实测

环境：Windows build 26200、Intel Core i7-14700KF、28逻辑处理器；独立 embedded Python进程；CTranslate2 4.8.2、SentencePiece 0.2.2、PySBD 0.3.4、CPU int8、两推理线程、禁用 MKL/packed GEMM。只使用本地磁盘模型。测量结果保存在未追踪的 src-tauri/target/argos-feasibility-20261010/light-measurements.json。

16条双向样本加第二次启动的8条重复样本全部返回译文；两进程正常退出。首次新进程 ready 448.89ms，后续新进程（已有磁盘缓存）156.96ms；每个方向首次加载和首条译文约125–129ms；已加载的短语约16–20ms，普通句子约24–73ms，约200–250字符的英文段落约80–105ms，中文段落约111ms。

ready RSS约31MiB，一个方向约130–133MiB，两方向约221–225MiB；私有内存约220MiB。都是**辅助进程增量**，不包含 LanDict 和 WebView2。空闲1秒采样CPU为0%。翻译瞬间有多线程CPU峰值；短请求的Windows CPU计时较粗，不能把逐条百分比误当任务管理器整机百分比。保留两线程和单进程串行请求，低配置机器的延迟和内存上限尚需实际目标机器验收。

实际样本：

- look forward to → 期待着；phase out → 逐步淘汰；by the way → 顺便说一句。
- The meeting has been postponed until Friday. → 会议推迟到星期五举行。
- Do not close this window before the download finishes. → 在下载完成前不要关闭此窗口 。
- The price increased by 12.5% in September 2025. → 2025年9月价格上涨12.5%。
- 期待与你见面 → Looking forward to meeting you.
- 会议推迟到了星期五。 → The meeting was postponed to Friday.
- 新闻段落关于清洁能源投资、家庭负担和政策的三句信息均保留。
- It is raining cats and dogs. → 下雨的猫和狗。**习语误译。**
- LanDict 被音译成“兰迪克特”；中文学习段落末句“理解它的意思”表达不充分。还存在空格、英文标点和文字风格不一致。

质量适合普通字面短语、基础句子和理解段落大意；不提供语境义解释、口语/学术双版本，也不能保证习语、专名、长距离上下文和无标点长句。UI只称“本地机器翻译”，不称词典释义或AI解释。AI的学习解释、语境义和不同文体继续作为手动选择。

## 离线与失败行为

验证在**独立进程内通过 Python audit hook禁止socket连接、DNS查询和sendto**，首次启动、模型加载和24次翻译网络尝试均为0。加源码检查：推理栈无远程API调用、无需下载断句模型。最终辅助进程也在这一禁网机制下完成24次翻译，Rust标准管道实测双向请求。没有断开用户网卡，也未进行全新Windows虚拟机上的物理断网安装；Tauri命令已注册并编译，实际桌面窗口操作验收尚未执行。本地翻译自身不得从用户设置读取API Key。

缺模型/运行环境：“本地翻译组件缺失，请重新安装完整版本。未调用 AI。”；进程启动失败或被安全软件阻止：“本地翻译无法启动，请检查组件是否被安全软件拦截。未调用 AI。”；超时：“本地翻译超时，请重试或缩短文本。未调用 AI。”；只提供重试，不自动转AI。AI卡片旁说明仅主动展开才调用，可能产生接口费用；保存配置和展开行为各自明确，连接测试仍是用户点击的在线操作。

## 许可证与运行生命周期

Argos库MIT（项目README亦允许CC0）；本次运行时直接用模型、CTranslate2 MIT、SentencePiece Apache-2.0、PySBD MIT、NumPy BSD及其wheel所含第三方声明、PyYAML MIT、Python PSF。两份模型README明确说明源OPUS-MT模型CC BY4.0，保留Jörg Tiedemann/Santhosh Thottingal及EAMT2020署名、原模型链接、许可全文及Argos转换来源。不能把模型说成MIT。wheel内的许可证目录、Python LICENSE和推理DLL的第三方声明一同分发。

LibreTranslate AGPLv3；MiniSBD也是AGPLv3，完整Argos1.11依赖包含它。当前推荐组合不分发这两项，亦不分发Stanza模型。若以后改用它们，需要重新评估对应源码及组合分发义务；独立进程不自动免除许可证要求。

避免PyInstaller onefile每次启动临时解压；使用固定安装目录中的私有解释器、明确参数和标准管道，隐藏控制台、限制输入、串行复用进程。真正退出时关闭/终止子进程，父进程崩溃时子进程也退出；隐藏到托盘不会泄漏多个进程。升级、卸载前停止进程，避免DLL被锁住。运行时不向安装目录写缓存，不落到用户的通用Argos目录；用户学习数据照常保留。首次安装、重复安装和卸载的完整端到端验证留到获准打包时进行。

未进行实际杀毒扫描，不能保证不会误报。SmartScreen根据下载和签名信誉判断，签名也不是保证；未来发布时签名主程序/辅助程序和安装包，并针对最终产物处理真实误报。不要求用户关闭杀毒软件。

## 最小接入与验收

1. 固定环境和模型版本，开发/构建前准备本地资源，保留许可；安装后的路径不依赖源码目录或系统Python。
2. Rust command 管理按需启动、JSONL请求、限长、超时、进程退出和重启；只返回本地结果，不调用AI。
3. 查询页和阅读页文本查询走本地provider；历史记录来源改为本地机器翻译。单词词典路径保持现有逻辑。
4. AI卡片默认折叠，逐次明确操作触发；移除自动AI入口及旧设置的自动请求行为。保留API设置、手动连接测试和学习解释。
5. 加入不自动AI的回归用例、长文本/中英/编码/失败测试；改动共享查询和数据流，提交前运行全量前端和Rust测试及不打包的编译检查。

本次用户已授权验证后直接接入，默认接受：A完整捆绑、英语↔简体中文、单一普通本地译文、按需启动、规则断句的质量局限、复用现有Card/Button样式。不制作安装包。**仍需用户在未来打包时决定**：是否额外支持全新电脑断网安装WebView2、最终体积是否接受、实际“VS Coding”上传目的地；本次不推断上传地址、不上传。

## 接入完成后的验证记录

2026-10-12：已按方案A接入源码。查询页、阅读页默认显示免费本地译文，单词仍走本地词典；AI卡片需手动展开，悬浮词卡与阅读单词语境义也保留明确的手动入口。设置中移除自动AI开关并忽略旧值；API凭据与手动连接测试保留。本地失败显示原因和“未调用 AI”，查询和阅读均可直接重试。切换查询会中止旧结果展示，历史预览不串到新查询。

正式准备目录包含私有Python、Windows x64推理wheels、两个模型、许可证和Visual C++ CRT DLL，实际额外磁盘占用301,461,676字节（287.50MiB）。模型与环境位于构建缓存，由准备脚本复现，未作为大型二进制提交Git；未来打包时由Tauri资源配置整体纳入安装包，用户首次使用无需下载。安装包估算仍为200–230MiB，尚无本次安装包实测。

验证证据：

- 全量Vitest：419项通过，0失败；覆盖有API配置时默认本地、旧自动AI设置、手动展开、无AI回退、失败重试和历史切换。报告在`src-tauri/target/full-test-result.json`。
- 全量`cargo test`：20项通过，0失败；真实私有Python管道双向翻译、缺环境、超时提示及Drop终止进程均通过。`cargo check --release`通过正式资源路径分支检查。
- 私有Python运行`-B tools/local-translation/test_worker.py`：9项通过；真实模型、中英断句、长句全部token保留、UTF-8 JSONL、错误恢复、禁网拒绝及父进程消失后退出。
- 最终`worker.py`和正式资源目录：24次翻译成功、标准输入关闭后正常退出。已有磁盘缓存的新进程ready为137.25ms；这不是冷启动数字。输入、输出和逐条耗时保存在`src-tauri/target/production-local-translation-smoke.json`。
- `tauri build --no-bundle --debug`通过，包含资源准备、TypeScript检查、Vite构建和Rust链接；未运行NSIS或bundle。构建保留既有CSS高亮、分块大小等非阻断警告。
- 完成一次独立只读代码审查，无已确认的新问题；随后补充失败重试与历史预览回归并通过全量测试。

本次没有制作、复制或上传安装包，也没有push。现有`LanDict_0.1.0_x64-setup.exe`仍是2026-10-09的旧文件，不能用于体验本次新功能。真实安装/重复安装/卸载、低配置机器和杀毒软件验收留待用户要求打包时执行。

## 正式安装目录路径修复（2026-10-12）

用户在实际安装版查询`wrap on`时反馈模型文件打开失败。模型文件位于`D:\Program Files (x86)\local-translation\models`且完整存在。直接用安装目录私有Python复现：普通路径四条中英请求均成功，换成Tauri返回的`\\?\D:\...`扩展路径后四条均报`Unable to open file 'model.bin'`。原因是CTranslate2文件加载器不接受该Windows路径前缀，开发目录测试此前未覆盖这一情况。

修复在辅助进程模型路径入口将Windows扩展路径转换为普通盘符/UNC路径。新回归用真实双向模型加载`\\?\`路径，修复前失败、修复后通过。源码、构建资源和当前安装目录的`worker.py`同步更新，三份文件SHA256一致；旧安装脚本备份在未追踪的`src-tauri/target/installed-worker-before-path-fix.py`。无需改模型或重装，当前应用点击本地重试即可重新加载脚本。

在正在运行的安装版窗口实际查询`wrap on`、`look forward to`、`phase out`和中英句子，译文正常显示，AI保持折叠。全量前端425项、Rust20项、Python10项通过；本次未打包安装包、未上传、未push。模型可读取并不等于所有短语译得准确：例如`wrap on`返回“包装”，短语缺少上下文时质量仍受模型限制。

## 官方来源

- [Argos模型索引](https://raw.githubusercontent.com/argosopentech/argospm-index/main/index.json)，大小及README另由本机下载ZIP实测。
- [Argos1.10依赖](https://raw.githubusercontent.com/argosopentech/argos-translate/v1.10.0/requirements.txt)、[Argos1.11依赖](https://raw.githubusercontent.com/argosopentech/argos-translate/v1.11.0/requirements.txt)、[MiniSBD许可](https://pypi.org/project/minisbd/)。
- [Python Windows embedded分发](https://docs.python.org/3/using/windows.html#the-embeddable-package)。
- [CTranslate2安装要求](https://opennmt.net/CTranslate2/installation.html)、[CPU支持](https://opennmt.net/CTranslate2/hardware_support.html)。
- [Tauri附加资源](https://v2.tauri.app/develop/resources/)、[Windows安装与WebView2](https://v2.tauri.app/distribute/windows-installer/)。
- [CC BY4.0条款](https://creativecommons.org/licenses/by/4.0/)、[LibreTranslate许可](https://raw.githubusercontent.com/LibreTranslate/LibreTranslate/main/LICENSE)。
- [微软CRT再分发](https://learn.microsoft.com/cpp/windows/redistributing-visual-cpp-files)、[SmartScreen](https://learn.microsoft.com/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen)。

# LanDict 内置英中机器翻译

基于已实测的[可行性报告](../../2026-10-12-local-translation-feasibility.md)。用户授权验证通过直接接入，明确禁止本次制作安装包。

单词继续词典；短语、句子、段落经desktop_local_translate自动本地翻译。请求{text,source:'en'|'zh',target:'en'|'zh'}，结果{translation,source,target}。自动方向沿用包含汉字则中译英，否则英译中；只接受不同的en/zh方向。限20,000字符，超长清晰报错，长句按256个SentencePiece token处理全部文本，保留段落换行。

私有Python3.12.10 embedded、CTranslate2 4.8.2、SentencePiece0.2.2、NumPy2.5.4、PyYAML6.0.3、PySBD0.3.4；Argos en_zh/zh_en1.9模型。原权重不改，不分发Stanza/PyTorch/Spacy/MiniSBD/LibreTranslate。CPU/int8、两线程，MKL及packed GEMM关闭。JSONL经stdin/stdout；无网络端口。Rust唯一惰性子进程串行复用，启动20秒、每次请求60秒超时；失败清理进程，用户重试时重新启动。关闭到托盘不退出；真正退出和父进程消失时结束辅助进程。

resources映射整个target/local-translation目录；构建工具下载并准备固定模型与官方Windows wheels，保留license文件与来源。用户电脑不需要Python/pip/API、不首次下载；开发时同一资源准备脚本，Windows x64之外清楚提示未支持。运行时禁止联网，不向安装目录写入pyc/cache。资源缺失提示重新安装，失败不自动AI。

查询/阅读/悬浮词卡的AI均仅在手动展开或明确手动语境义操作后请求；移除自动AI开关，忽略历史aiEnabled=true。免费本地结果状态不被AI错误覆盖。查询历史来源和预览来自本地结果。AI凭据和手动连接测试继续保留。复用现有Card、Button、图标、面板布局，不引入视觉重设计。

验收：普通双向输入、否定和数字不失真；24条实测无网络尝试；中文UTF-8；空白/不支持方向/超长/长句/模型缺失/超时；切换查询不显示旧结果；配置API和旧自动设置也不得自动AI；显式展开才请求且错误不覆盖本地结果。全量前端和Rust测试；Tauri只用--no-bundle编译，不运行bundle或NSIS脚本。安装/卸载/签名/上传验收留到用户要求打包时。

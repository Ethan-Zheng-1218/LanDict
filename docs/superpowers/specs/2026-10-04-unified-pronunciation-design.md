# 统一英美音标与发音设计

## 目标

让 LanDict 的查词页、阅读器和生词本为同一单词展示并播放同一组发音数据：

- 英式：Unicode 国际音标（British English / BrE）与对应英式音频；
- 美式：Unicode 国际音标（North American English / NAmE）与对应美式音频；
- 保存进生词本的数据与查词页完全一致，不再混入 ECDICT 的单条音标或韦氏重拼标记。

## 约束与数据源

项目已有两份本地词典：牛津高阶双解第七版（OALD7）和 Merriam-Webster's Collegiate Dictionary 2015。

- OALD7 的词头含英式音标，部分词条额外含 `NAmE` 音标。它们使用 Kingsoft Phonetic Plain 字体的字符编码，而非可直接展示的 Unicode IPA。
- OALD7 的 MDD 资源包只含图片和样式，不含可播放的语音文件。
- Merriam-Webster 词条含美式音频 ID，可映射到其在线 MP3；其文字转写是 Merriam-Webster respelling，不是 IPA。
- 现有免费服务可提供补充 IPA 和英式音频，但不是默认的本地词典展示来源。

## 统一模型

新增共享的发音模型，所有消费者只读取这个模型：

```ts
type AccentPronunciation = {
  ipa: string;
  audioUrl?: string;
  ipaSource: "oxford" | "fallback";
  audioSource: "merriam-webster" | "dictionary-api" | "system-tts";
};

type WordPronunciation = {
  british: AccentPronunciation;
  american: AccentPronunciation;
};
```

`ipa` 只允许标准 Unicode IPA。韦氏重拼、ECDICT 原始音标和空白值不得写入该字段。

## 来源优先级

| 口音 | IPA | 音频 |
|---|---|---|
| 英式 | 解码后的牛津 BrE | 免费 DictionaryAPI 英式音频；不可用时系统 TTS |
| 美式 | 解码后的牛津 NAmE；缺失时免费 IPA 服务 | Merriam-Webster 美式 MP3；不可用时系统 TTS |

韦氏文本重拼不进入展示或持久化。首版不实现 Merriam-Webster respelling 到 IPA 的自动转换，因为音位、重音、可选成分和变体标记存在歧义；牛津 NAmE 更适合作为美式 IPA 的主来源。

## 牛津 IPA 解码

牛津模块扩展为解析词头的 Kingsoft Phonetic Plain 文本，分别读取默认 BrE 和 `NAmE` 段落。一个纯函数将编码转换为 Unicode IPA：

- 保留主、次重音、长音、可选的 `(r)` 与词条中的音标分隔；
- 转换所有 OALD7 使用的元音、辅音及双元音标记；
- 将结果标准化为 `/.../`；
- 无法完整转换的条目返回空字符串，交给明确的后备来源，而不是输出错误 IPA。

测试会以具有英美差异的词（如 `schedule`、`water`）以及英美相同的词验证映射和解析。

## 页面与存储行为

### 查词页

顶部固定显示两个控件：`英 /.../` 和 `美 /.../`。点击英式控件播放英式音频；点击美式控件播放韦氏音频。音频回退为系统 TTS 时，通过 title/辅助文本明确标注，不能暗中改变来源。

### 阅读器

单词弹窗、右侧词汇面板都显示同一对 IPA。英/美按钮使用统一模型；整篇听读和“选中文本朗读”仍是内容朗读，不伪装成词典发音，但继续使用现有英式 TTS。

### 生词本

写入时持久化统一模型的两条 IPA。列表中英/美按钮播放同一模型的对应音频，不再在页面加载后把保存值替换为 ECDICT 或韦氏重拼。

### 静态原型

`design html` 下的阅读器与生词本原型同步为双 IPA 标签及相同的英/美按钮语义。它们没有后端数据层，继续以系统 TTS 演示音频，但不再展示单一泛用音标。

## 错误与回退

- 任一 IPA 缺失时显示 `—`，不以非 IPA 文本替代；
- 任一网络音频不可播放时使用匹配口音的系统 TTS；
- 本地词典不可用不阻断免费后备 IPA/音频的加载；
- 请求取消或切换单词时不得用旧词的异步结果覆盖新词。

## 验收与测试

- 单元测试：Kingsoft 到 IPA 映射、牛津 BrE/NAmE 提取、来源优先级；
- 服务测试：美式韦氏音频与 IPA 来源彼此独立但口音匹配；
- 页面测试：查词页、阅读器和生词本对同一词显示相同 IPA；
- 回归修复：现有韦氏 `schedule` 变体断言，以及生词本音标回填测试；
- 完整测试与构建在提交前通过。

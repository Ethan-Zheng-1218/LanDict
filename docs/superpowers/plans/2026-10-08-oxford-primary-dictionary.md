# LanDict 底层内置词库更换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把安装包中 812 MiB 的 ECDICT 换成「牛津主库 + 精简 ECDICT 兜底 + CC-CEDICT 反查」，词库部分降到约 44 MiB，同时把查词、中文反查、词形还原、阅读页词族四条链路完整迁移。

**Architecture:** 构建期把牛津 .mdx 与 CC-CEDICT 文本解析成两份新 SQLite，并把 ECDICT 原地替换为精简版；运行期 Rust 与 Node 只保留「按词批量取条目」的原子查询，候选词生成、来源优先级、反查排序全部集中到一份共享 TypeScript 策略层，开发版与桌面版共用。

**Tech Stack:** TypeScript、React 19、Vite 5、Vitest、Tauri 2、Rust（rusqlite）、`@runer-hq/mdict`、`node:sqlite`。

**Spec:** `docs/superpowers/specs/2026-10-07-oxford-primary-dictionary-design.md`

## 进度

Task 1-5 已完成并提交，从 Task 6 继续。勾选状态只反映「哪一步做过」，实施中偏离计划的决定在下面逐一记录。

| 任务 | 状态 | 提交 |
| --- | --- | --- |
| 1 CC-CEDICT 反查索引 | 完成 | `240a016` |
| 2 牛津主库 | 完成 | `74de361` |
| 3 精简 ECDICT | 完成 | `25461f3` |
| 4 统一构建入口与产物记录 | 完成 | `99a81f0` |
| 5 词形还原器 | 完成 | `55deb4f` |
| 6 批量原子查询接口 | 完成 | `55b4767` |
| 7 策略层——查词合并 | 完成 | `172de13` |
| 8 策略层——中文反查排序 | 完成 | `1172e99` |
| 9 接入查词与反查界面路径 | 完成 | `1c46729` |
| 10 阅读页词族接入 | 完成 | `73583b7` |
| 11 打包配置与路径解析 | 完成 | 见下一次提交 |
| 12 安装版实测与体积确认 | 按用户指示跳过 | — |

当前词库产物合计 44.6 MiB（CC-CEDICT 7.0 + 牛津 27.5 + 精简 ECDICT 10.1），原为 812 MiB。`pnpm build:dictionaries` 一条命令可重建全部三份。

实施中已发生的偏离，改动前务必先读对应任务里的说明：精简库改用独立文件名 `stardict-slim.db`；精简库追加了 `bnc`/`frq` 两列；变形词被剔除后不再有自己的条目。

## Global Constraints

- 音标与音频链路一律不得改动：`src/features/translation/pronunciationService.ts`、`server/oxford.ts` 的 `queryOxfordPronunciation` 与 `parseOxfordPronunciation`、`server/merriamWebster.ts`、`src/features/reading/speech.ts`。任何任务若需要改这四个文件，停下并确认。
- 新牛津库不存音标字段，理由见设计文档 5.4。
- 提交只到本地 Git，不执行 `git push`。
- 每个任务结束时必须创建一次本地提交。
- 本次涉及数据层与打包配置，属于公共改动：在**任务 11 提交前**运行一次全量测试 `pnpm test`。
- 产物路径固定：`data/oxford-sqlite/landict-oxford.db`、`data/ecdict-sqlite-28/stardict.db`、`data/cedict-sqlite/landict-cedict.db`、`data/dictionary-build.json`。
- 中文反查返回条数上限为 **6**。
- 精简 ECDICT 筛选口径为：`coalesce(collins,0) > 0 OR oxford = 1 OR bnc BETWEEN 1 AND 50000 OR frq BETWEEN 1 AND 50000`，再过滤完整英文词与空中文释义。
- 构建脚本运行需要 Node 22.5 以上（`node:sqlite` 为内建模块）。

## Review Focus

以下五类输入或失败模式在设计文档里没有逐条展开，但最可能让使用者难受。任务 5、6、7、8、11 的测试必须覆盖对应行。

1. **词典里没有的词**：使用者查任何不存在的词（`qqxzvnotaword`）或超出精简库的生僻词，必须返回「未收录」文案，不得报错或白屏。
2. **大小写与专名**：`America`、`York` 这类牛津不收的专有名词，查词不得抛异常，需走精简 ECDICT 兜底并正确显示。
3. **带连字符与撇号的词**：`mother-in-law`、`don't`、`well-known` 必须能通过输入校验并查到，不能被规范化逻辑误判为非法。
4. **中文一词多义**：`生气` 在 CC-CEDICT 里对应 vitality，`猫` 对应 modem，排序必须靠英文词频把这两个冷门义项压出前 6。
5. **安装后词库路径**：打包版资源目录与开发目录不同，词库文件缺失时必须走回退分支而不是崩在启动路径上。

---

## Task 1: CC-CEDICT 反查索引

**Files:**
- Create: `data/cedict/cedict.txt`（CC-CEDICT 原始文本，9.40 MiB）
- Create: `data/cedict/CC-CEDICT-LICENSE.txt`
- Create: `tools/cedict.mjs`
- Test: `tools/cedict.test.mjs`
- Create: `tools/build-cedict.mjs`

**Interfaces:**
- Produces: `parseCedictEntries(text: string): { traditional: string; simplified: string; pinyin: string; glosses: string[] }[]`
- Produces: `toReverseIndex(entries): Map<string, string[]>`，键为简体词，值为英文对应词（已去 `to ` 前缀、去括号限定语、去重、只保留英文单词与短语）
- Produces: `data/cedict-sqlite/landict-cedict.db`，表 `cedict(term TEXT, gloss TEXT)`，索引 `idx_cedict_term`

原始文件下载地址 `https://cc-cedict.org/editor/editor_export_cedict.php?c=gzip`（该地址返回的是未压缩纯文本，不是 gzip）。文件为 CRLF 换行，解析前必须按 `\r?\n` 切分。

- [x] **Step 1: 下载原始数据并落盘**

把下载结果保存为 `data/cedict/cedict.txt`，把 CC BY-SA 4.0 许可声明与来源写入 `data/cedict/CC-CEDICT-LICENSE.txt`。确认文件以 `# CC-CEDICT` 开头、行数约 12 万。

- [x] **Step 2: 写失败测试**

```js
// tools/cedict.test.mjs
import { expect, it } from "vitest";
import { parseCedictEntries, toReverseIndex } from "./cedict.mjs";

const SAMPLE = [
  "#! this line is a comment",
  "放棄 放弃 [fang4 qi4] /to renounce; to abandon; to give up/",
  "貓 猫 [mao1] /cat/ (coll.) modem/",
  "",
].join("\r\n");

it("parses simplified, traditional and pinyin and skips comments", () => {
  const entries = parseCedictEntries(SAMPLE);
  expect(entries).toHaveLength(2);
  expect(entries[0]).toEqual({
    traditional: "放棄",
    simplified: "放弃",
    pinyin: "fang4 qi4",
    glosses: ["to renounce; to abandon; to give up"],
  });
});

it("indexes simplified terms with de-prefixed English glosses", () => {
  const index = toReverseIndex(parseCedictEntries(SAMPLE));
  expect(index.get("放弃")).toEqual(["renounce", "abandon", "give up"]);
  expect(index.get("猫")).toContain("cat");
});
```

- [x] **Step 3: 运行测试确认失败**

Run: `pnpm vitest run tools/cedict.test.mjs`
Expected: FAIL，报 `Failed to resolve import "./cedict.mjs"`

- [x] **Step 4: 实现 `tools/cedict.mjs`**

导出上述两个函数。解析行格式 `/^(\S+)\s+(\S+)\s+\[([^\]]*)\]\s+\/(.*)\/$/`；按 `/` 切分英文部分，再按 `[;,（()]` 拆分片段；每段去掉 `^to\s+`、去掉括号内容、转小写、只保留匹配 `/^[a-z][a-z-]*(\s[a-z][a-z-]*)*$/` 且长度大于 1 的结果。

- [x] **Step 5: 运行测试确认通过**

Run: `pnpm vitest run tools/cedict.test.mjs`
Expected: PASS

- [x] **Step 6: 实现建库脚本 `tools/build-cedict.mjs`**

读取 `data/cedict/cedict.txt`，调用上面两个函数，写入 `data/cedict-sqlite/landict-cedict.db`，建 `cedict(term, gloss)` 表与 `idx_cedict_term` 索引，结束后打印词条数与文件字节数。

- [x] **Step 7: 运行脚本并核对断言**

Run: `node tools/build-cedict.mjs`
Expected: 中文词数 ≥ 90,000，文件约 7 MiB。若低于 50,000，脚本会直接抛错退出，说明解析口径已失效。

- [x] **Step 8: 提交**

```bash
git add data/cedict tools/cedict.mjs tools/cedict.test.mjs tools/build-cedict.mjs .gitignore
git commit -m "feat: 新增 CC-CEDICT 反查索引与构建脚本"
```

生成的 `data/cedict-sqlite/` 是构建产物，已加入 `.gitignore`，不进版本库——与现有 `stardict.db` 的做法一致。随仓库保留的是可直接解析的源文本 `data/cedict/cedict.txt`。

---

## Task 2: 牛津主库

**Files:**
- Create: `tools/oxford-build.mjs`
- Test: `tools/oxford-build.test.mjs`
- Create: `tools/build-oxford.mjs`

**Interfaces:**
- Produces: `parseOxfordEntry(html: string, word: string): OxfordEntry`
- Produces: `extractHanziIndex(entries: OxfordEntry[]): { term: string; word: string; senseIndex: number }[]`
- Produces: `data/oxford-sqlite/landict-oxford.db`，表 `entry`、`hanzi`、`lemma`

```ts
type OxfordEntry = {
  word: string;
  headword: string;
  pos: string;
  senses: { pos: string; definition: string; translation: string }[];
  collocations: string[];
  examples: { pos: string; text: string; translation?: string }[];
  lemmaBase?: string;   // 「pt of run」「pl. of man」这类变形条目指向的原形
};
```

抽取口径，均已在设计核实阶段验证：

- 义项中文翻译：`<font ... color=#FF5000>…</font>`（每条义项一行，形如 `• 猫`）
- 例句英文与翻译：`<SPAN style="color:#04F">` 与紧随的 `<font style="color:#039;font-size:90%">`
- 搭配：`text-decoration:underline` 的 span，去掉行首 `~` 后补上词头
- 变形条目：全文含 `pt of`、`pp of`、`pl. of`、`--› see`，把被指向的词填进 `lemmaBase`
- 中文索引：只取 `#FF5000` 段落，**先整体丢弃括号限定语**，再按 `[，,；;、]` 切分，每段只保留汉字且长度 1–6

- [x] **Step 1: 写失败测试**

```js
// tools/oxford-build.test.mjs
import { expect, it } from "vitest";
import { parseOxfordEntry, extractHanziIndex } from "./oxford-build.mjs";

const CAT = `<b>cat </b><font color=darkred><b><i>noun </i></b></font><br> 1. a small animal.<br><font color=#FF5000>&bull; 猫</font>:<br><SPAN style="color:#04F">&nbsp;&raquo;cat food </SPAN><br><font style="color:#039;font-size:90%">&nbsp;&nbsp;猫食品 </font>`;
const RAN = `<b>ran </b>pt of<b> <a href="entry://run">run</a> </b>`;
const WHISKER = `<font color=#FF5000>&bull; (猫、鼠等的)须</font>`;

it("reads the sense translation, its part of speech and the example pair", () => {
  const entry = parseOxfordEntry(CAT, "cat");
  expect(entry.pos).toBe("noun");
  expect(entry.senses[0].translation).toBe("猫");
  expect(entry.examples[0]).toEqual({ pos: "noun", text: "cat food", translation: "猫食品" });
});

it("records the lemma a plain inflection points at", () => {
  expect(parseOxfordEntry(RAN, "ran").lemmaBase).toBe("run");
});

it("does not index Chinese that only appears inside a parenthetical qualifier", () => {
  const index = extractHanziIndex([parseOxfordEntry(WHISKER, "whisker")]);
  expect(index.map((item) => item.term)).toEqual(["鼠等的须"]);
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tools/oxford-build.test.mjs`
Expected: FAIL，报无法解析 `./oxford-build.mjs`

- [x] **Step 3: 实现 `tools/oxford-build.mjs`**

用 `JSDOM.fragment` 解析 HTML（`jsdom` 已是项目依赖）。括号丢弃必须在切分之前做，否则 `(猫、鼠等的)须` 会把 `猫` 当成命中，这正是设计文档记录的反查噪音来源。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tools/oxford-build.test.mjs`
Expected: PASS

- [x] **Step 5: 实现建库脚本 `tools/build-oxford.mjs`**

用 `@runer-hq/mdict` 打开 `data/牛津高阶双解 …7th.mdx`，遍历 `listKeywords()`，逐条 `fetch` 后调用解析函数，写入 `data/oxford-sqlite/landict-oxford.db`。`senses`、`collocations`、`examples` 以 JSON 文本落库。遍历时同步收集 `lemma` 表内容。

- [x] **Step 6: 运行脚本并核对断言**

Run: `node tools/build-oxford.mjs`
Expected: `entry` 表 42,338 行（42,481 个关键词归并大小写同形条目后）；`lemma` 表约 431 行；`hanzi` 表不少于 140,000 行；文件约 27.5 MiB。若 `hanzi` 明显偏小，检查括号丢弃是否误伤正文。

- [x] **Step 7: 抽样人工核对**

对 `cat`、`abandon`、`schedule` 三个词打印解析结果，确认义项、例句、搭配没有串行。实施时已核实四个坑，改解析时不要退化回去：

- 词头会带上牛津的核心词符号 `♠`，必须剥掉。
- `--› see also` 交叉引用那一行会串进下一个义项的释义，必须在 `<br>` 处分行丢弃。
- `【VN】【SYNONYMS】【HELP】` 是语法与用法标记，不是成语区；只有 `【IDIOMS】` 之后的义项才带 `idiom` 标记，否则 `abandon` 的正常义项会被整片误标。
- 搭配与例句是 SPAN 子树，释义必须在 DOM 上逐节点遍历取得，用字符串标记再切分会让例句文本漏进释义。

另有一处已知不足：牛津源 HTML 里部分搭配的 SPAN 嵌套不闭合（如 `the big cats (= lions…`），截取会偏短。现有 `server/oxford.ts` 有同样行为，本任务不修。

- [x] **Step 8: 提交**

```bash
git add tools/oxford-build.mjs tools/oxford-build.test.mjs tools/build-oxford.mjs
git commit -m "feat: 新增牛津主库构建脚本"
```

---

## Task 3: 精简 ECDICT

**Files:**
- Create: `tools/build-ecdict.mjs`
- Test: `tools/build-ecdict.test.mjs`

**Interfaces:**
- Produces: `buildSlimEcdict(sourcePath: string, targetPath: string): { sourceRows: number; keptRows: number }`
- Produces: `data/ecdict-sqlite-28/stardict-slim.db`（新增精简版；源库保持不动）

表结构保持现有六列并在末尾追加 `bnc`、`frq`：`stardict(word, phonetic, definition, translation, pos, exchange, bnc, frq)`。追加两列是必需的——中文反查排序要用 `bnc` 当英文词频。全仓库没有 `SELECT *`，追加列不影响既有查询。

**实施时的两处偏离，改动前请先读：**

- 精简库用独立文件名 `stardict-slim.db`，不覆盖 `stardict.db`。本机有外部程序长期持有源库句柄，改名与覆盖都返回 EBUSY。代码侧 `server/ecdict.ts`、`server/ecdict.test.ts`、`src-tauri/tauri.conf.json`、`src-tauri/src/desktop_queries.rs` 已全部指向新文件名。
- 变形词（`ran`、`went`、`mice`、`knives`、`walked`）在 ECDICT 里词频为 0，会被剔除且不再有自己的条目，改由 exchange 索引落到原型。`server/ecdict.test.ts` 中原本依赖变形词独立条目的用例已按新行为改写。

- [x] **Step 1: 写失败测试**

```js
// tools/build-ecdict.test.mjs
import { expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSlimEcdict } from "./build-ecdict.mjs";

it("keeps every headword the BNC ranks inside the top 50,000", () => {
  const target = join(mkdtempSync(join(tmpdir(), "slim-")), "slim.db");
  const result = buildSlimEcdict("data/ecdict-sqlite-28/stardict.db", target);
  expect(result.keptRows).toBeGreaterThan(58_000);
  const db = new DatabaseSync(target, { readOnly: true });
  const kept = db.prepare(
    "SELECT count(*) c FROM stardict WHERE bnc BETWEEN 1 AND 50000",
  ).get().c;
  expect(kept).toBe(19_316 + 26_127);
  db.close();
});
```

> 若源库已被上一次运行覆盖成精简版，先在 `git stash` 外的副本上跑，或从备份 `F:\200_学习\220_技能工具\221_编程开发\LanDict\data` 取回完整库。

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tools/build-ecdict.test.mjs`
Expected: FAIL，报无法解析 `./build-ecdict.mjs`

- [x] **Step 3: 实现 `buildSlimEcdict`**

用 `node:sqlite` 只读打开源库，建同结构目标库，按 Global Constraints 里的筛选 SQL 逐行复制，`VACUUM` 后返回统计。**复制到目标路径前不得改动源库**；建议先写临时文件再原子替换。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tools/build-ecdict.test.mjs`
Expected: PASS

- [x] **Step 5: 对完整库执行一次并记录体积**

Run: `node -e "import('./tools/build-ecdict.mjs').then(m => console.log(m.buildSlimEcdict('data/ecdict-sqlite-28/stardict.db','data/ecdict-sqlite-28/stardict-slim.db')))"`
Expected: `keptRows` 为 58,331，`stardict-slim.db` 约 9.7 MiB。确认无误后再用它替换 `stardict.db`。

- [x] **Step 6: 提交**

```bash
git add tools/build-ecdict.mjs tools/build-ecdict.test.mjs
git commit -m "feat: 新增精简 ECDICT 构建脚本"
```

---

## Task 4: 统一构建入口与产物记录

**Files:**
- Create: `tools/build-dictionaries.mjs`
- Create: `data/dictionary-build.json`（生成物）
- Modify: `package.json`（新增 `build:dictionaries` 脚本）

**Interfaces:**
- Consumes: `tools/cedict.mjs`、`tools/oxford-build.mjs`、`tools/build-ecdict.mjs`
- Produces: `data/dictionary-build.json`，含各产物的源文件哈希、生成时间、行数、筛选口径

- [x] **Step 1: 实现入口脚本**

顺序调用三个构建步骤，各自完成后重新读取产物统计，写入 `data/dictionary-build.json`。任一步骤的行数低于设计文档第二节的断言值时，脚本以非零退出码结束并打印是哪一项不达标。

- [x] **Step 2: 在 `package.json` 注册脚本**

新增 `"build:dictionaries": "node tools/build-dictionaries.mjs"`，放在 `build` 之前，不改动既有脚本。

- [x] **Step 3: 完整跑一次**

Run: `pnpm build:dictionaries`
Expected: 三个产物全部生成，`data/dictionary-build.json` 的 `rows` 字段分别为 55,963 / 42,481 / 58,331，脚本退出码 0。

- [x] **Step 4: 故意破坏一项断言确认脚本会失败**

临时把断言阈值改成不可能满足的值，运行一次，确认脚本以非零退出码结束并打印具体项；改回后再次运行确认恢复通过。

- [x] **Step 5: 提交**

```bash
git add tools/build-dictionaries.mjs package.json data/dictionary-build.json
git commit -m "feat: 新增词库统一构建入口与产物记录"
```

---

## Task 5: 词形还原器

**Files:**
- Create: `src/lib/lemmatizer.ts`
- Test: `src/lib/lemmatizer.test.ts`
- Modify: `src/features/reading/wordMatch.ts`

**Interfaces:**
- Produces: `IRREGULAR_FORMS: Readonly<Record<string, string>>`（约 200 条常见不规则变形）
- Produces: `baseFormCandidates(word: string): string[]`（由 `wordMatch.ts` 迁出并扩展派生后缀规则）
- Produces: `lemmaCandidates(word: string): string[]`（先给不规则原形，再给规则候选，去重）

从 `wordMatch.ts` 迁出时**必须保持 `baseFormCandidates` 现有行为不变**，`wordMatch.test.ts` 现有的断言不许改动。新增的派生后缀规则（`-ly`、`-er/-est`、`-ness`、`-ment`、`-ation`）只在候选经过词典验证后才生效，因此它们只影响 `lemmaCandidates` 的候选列表顺序，不改变 `buildWordMatcher` 的判定。

- [x] **Step 1: 写失败测试**

```ts
// src/lib/lemmatizer.test.ts
import { expect, it } from "vitest";
import { baseFormCandidates, lemmaCandidates } from "./lemmatizer";

it("keeps the existing regular rule behavior", () => {
  expect(baseFormCandidates("studies")).toContain("study");
  expect(baseFormCandidates("stopped")).toContain("stop");
  expect(baseFormCandidates("used")).not.toContain("us");
});

it("puts the irregular base form first", () => {
  expect(lemmaCandidates("ran")[0]).toBe("run");
  expect(lemmaCandidates("children")[0]).toBe("child");
  expect(lemmaCandidates("better")[0]).toBe("good");
});

it("offers derived-base candidates without claiming they are words", () => {
  expect(lemmaCandidates("carefully")).toContain("careful");
  expect(lemmaCandidates("previously")).toContain("previous");
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run src/lib/lemmatizer.test.ts`
Expected: FAIL，报无法解析 `./lemmatizer`

- [x] **Step 3: 实现 `src/lib/lemmatizer.ts`**

把 `baseFormCandidates` 原样迁入并导出，补上派生后缀候选。`IRREGULAR_FORMS` 至少覆盖设计文档 7.3 列举的 ran/went/children/better/taking/studies 一类。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run src/lib/lemmatizer.test.ts src/features/reading/wordMatch.test.ts`
Expected: 两个文件全部 PASS，`wordMatch.test.ts` 的断言未做任何修改即通过。

- [x] **Step 5: 让 `wordMatch.ts` 复用迁出后的实现**

`wordMatch.ts` 改为从 `src/lib/lemmatizer` 导入并重新导出 `baseFormCandidates`，删除本地副本，保持其余逻辑不变。

- [x] **Step 6: 回归确认**

Run: `pnpm vitest run src/lib/lemmatizer.test.ts src/features/reading/wordMatch.test.ts src/features/reading/ReadingArticlePage.test.tsx`
Expected: 全部 PASS

- [x] **Step 7: 提交**

```bash
git add src/lib/lemmatizer.ts src/lib/lemmatizer.test.ts src/features/reading/wordMatch.ts
git commit -m "refactor: 抽出共享词形还原器"
```

---

## Task 6: 批量原子查询接口

**Files:**
- Create: `server/dictionaryLookup.ts`
- Test: `server/dictionaryLookup.test.ts`
- Modify: `vite.config.ts`（新增 `/api/dictionary-lookup` 与 `/api/dictionary-reverse` 中间件）
- Modify: `src-tauri/src/desktop_queries.rs`（新增对应命令）
- Test: `src-tauri/src/desktop_queries.rs` 内的 `#[cfg(test)]` 模块

**Interfaces:**
- Produces（Node 与 Rust 同名同形）：
  - `lookupWords(words: string[]): Record<string, { oxford?: OxfordEntry; ecdict?: EcdictRecord }>`
  - `reverseLookup(term: string): { word: string; source: "cedict" | "oxford" | "ecdict"; senseIndex?: number }[]`
  - `lookupLemmas(words: string[]): Record<string, string>`
- Produces（Tauri 命令名）：`desktop_dictionary_lookup`、`desktop_dictionary_reverse`、`desktop_dictionary_lemmas`
- Consumes: Task 1、2、3 生成的三份 SQLite

> 实施修正两处，改动前先读：
>
> - Tauri 命令名去掉了 `desktop_` 前缀，实际为 `dictionary_lookup`、`dictionary_reverse`、`dictionary_lemmas`。既有的 `desktop_dictionary` 保持不动，Task 9 切换前端后它就不再被调用。
> - `ReverseHit` 增加一个可选 `rank` 字段（精简 ECDICT 的 bnc 词频）。Task 8 的排序规则第一条就是按英文词频排，把词频放在这一层返回，策略层不必为每个候选再发一次请求。
>
> 另有两点实现选择：ECDICT 那一支直接复用 `server/ecdict.ts` 的 `queryEcdict` 与 `queryEcdictReverse`，不重复写查询；三份库各自独立打开，缺哪份就把哪份当空结果，不抛异常——开发机在跑完构建脚本之前就是这种状态。

这一层**只取数据，不做任何优先级判断**。哪条命中优先、取几条、怎么排序，全部留给 Task 7、8 的策略层。

- [x] **Step 1: 写失败测试**

```ts
// server/dictionaryLookup.test.ts
import { expect, it } from "vitest";
import { lookupWords, reverseLookup, lookupLemmas } from "./dictionaryLookup";

it("returns the Oxford entry and the trimmed ECDICT entry side by side", async () => {
  const result = await lookupWords(["cat"]);
  expect(result.cat.oxford?.senses[0].translation).toBe("猫");
  expect(result.cat.ecdict?.word).toBe("cat");
});

it("answers unknown words with an empty record instead of throwing", async () => {
  const result = await lookupWords(["qqxzvnotaword"]);
  expect(result.qqxzvnotaword).toEqual({});
});

it("resolves Chinese through CC-CEDICT first and keeps a sense position for Oxford", async () => {
  const hits = await reverseLookup("放弃");
  expect(hits.map((hit) => hit.word)).toContain("abandon");
  expect(reverseLookup("猫").some((hit) => hit.source === "oxford" && hit.senseIndex !== undefined)).resolves.toBe(true);
});

it("maps an irregular inflection to its lemma", async () => {
  expect(await lookupLemmas(["ran"])).toEqual({ ran: "run" });
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run server/dictionaryLookup.test.ts`
Expected: FAIL，报无法解析 `./dictionaryLookup`

- [x] **Step 3: 实现 `server/dictionaryLookup.ts`**

用 `node:sqlite` 只读打开三份库，语句按词表批量执行。三个库任意一个缺失时，把该来源当作空结果返回，**不抛异常**——开发机在跑完 Task 4 之前就属于这种情况。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run server/dictionaryLookup.test.ts`
Expected: PASS

- [x] **Step 5: 在 `vite.config.ts` 挂上中间件**

新增 `POST /api/dictionary-lookup`、`POST /api/dictionary-reverse`，请求体为 JSON，复用与现有 `/api/local-dictionary` 相同的输入校验（英文词 `^[a-zA-Z]+(?:[-'][a-zA-Z]+)*$`、中文不限长度但只能是汉字）。**保留现有 `/api/local-dictionary` 与 `/api/word-family` 不动**，音标链路依赖前者。

- [x] **Step 6: 在 Rust 侧实现同名命令**

在 `desktop_queries.rs` 新增三个 `#[tauri::command]`，并在 `lib.rs` 的 `generate_handler!` 注册。词库路径解析沿用现有逻辑：先找 `resource_dir()/dictionaries/`，`debug_assertions` 下缺文件时回退到仓库 `../data/...`。三个库各自独立打开，缺哪个就把哪个当空结果。

- [x] **Step 7: 补 Rust 单元测试并运行**

在 `desktop_queries.rs` 的测试模块里用内存库断言：批量查询能同时返回两个来源、未知词返回空、中文反查返回 CC-CEDICT 命中。

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS

- [x] **Step 8: 提交**

```bash
git add server/dictionaryLookup.ts server/dictionaryLookup.test.ts vite.config.ts src-tauri/src/desktop_queries.rs src-tauri/src/lib.rs
git commit -m "feat: 新增批量词典原子查询接口"
```

---

## Task 7: 策略层——查词合并

**Files:**
- Create: `src/features/translation/dictionaryResolver.ts`
- Test: `src/features/translation/dictionaryResolver.test.ts`

**Interfaces:**
- Consumes: Task 6 的三个函数
- Produces: `type DictionaryAtomicApi = { lookupWords; reverseLookup; lookupLemmas }`
- Produces: `resolveWordQuery(query: string, api: DictionaryAtomicApi, signal?: AbortSignal): Promise<WordQueryResult>`

优先级（设计文档 7.1）：牛津精确 → 牛津经词形还原 → 精简 ECDICT 精确 → 精简 ECDICT 经词形还原 → 未收录。命中牛津时 `meanings`、`examples`、`collocations`、`meaning` 全部取牛津；命中 ECDICT 时展示与现状一致。

> **实施时改了四处，动手前先读：**
>
> 1. `DictionaryAtomicApi` 增加一个**可选**的 `lookupPronunciation(word)`。这是保住「音标与音频不动」这条硬边界所必需的：迁移前开发版的音标走 `/api/local-dictionary` 的牛津 IPA、桌面版走 `desktop_dictionary` 的 ECDICT 音标，如果新链路不带音标，开发版的音标来源就会从牛津 IPA 变成 ECDICT，那是实打实的行为变更。做成可选方法后，两端各自注入自己的实现，音标来源与今天完全一致；不注入时只影响音标展示字段，释义照常。
> 2. 计划里那段「词形还原」的测试用了两次 `mockResolvedValueOnce`，隐含两次往返，与同一节 Interfaces 写的「一次把原词加全部候选原形发过去」矛盾。以 Interfaces 为准：`lookupWords` 只调用一次，测试已按一次往返改写。
> 3. 牛津的成语义项（`idiom: true`）不计入 `meanings`。`be the cat's whiskers` 是成语，不是 cat 这个词的义项，混进来会让查 cat 的第一条释义变成「最棒的东西」。词汇表里的 `examples` 也从 `pos` 映射成界面类型要求的 `partOfSpeech`。
> 4. 中文输入不归这一层管，`resolveWordQuery` 只处理英文词；中文走 Task 8 的 `resolveChineseQuery`，由 Task 9 负责分派。

- [x] **Step 1: 写失败测试**

```ts
import { expect, it, vi } from "vitest";
import { resolveWordQuery } from "./dictionaryResolver";

const api = (lookupWords) => ({ lookupWords, reverseLookup: vi.fn(), lookupLemmas: vi.fn().mockResolvedValue({}) });

it("prefers the Oxford entry over the ECDICT one", async () => {
  const result = await resolveWordQuery("cat", api(vi.fn().mockResolvedValue({
    cat: { oxford: { senses: [{ pos: "noun", definition: "a small animal.", translation: "猫" }], collocations: [], examples: [] }, ecdict: { word: "cat", translation: "n. 猫" } },
  })));
  expect(result.meaning).toBe("猫");
  expect(result.source).toBe("牛津高阶");
});

it("falls back to a lemma form when the surface form is absent", async () => {
  const lookup = vi.fn()
    .mockResolvedValueOnce({ stopped: {} })
    .mockResolvedValueOnce({ stop: { oxford: { senses: [{ pos: "verb", definition: "to end.", translation: "停止" }], collocations: [], examples: [] } } });
  const result = await resolveWordQuery("stopped", api(lookup));
  expect(result.meaning).toBe("停止");
});

it("reports an unknown word as empty rather than throwing", async () => {
  const result = await resolveWordQuery("qqxzvnotaword", api(vi.fn().mockResolvedValue({ qqxzvnotaword: {} })));
  expect(result.status).toBe("empty");
});

it("accepts hyphenated and apostrophe words", async () => {
  const lookup = vi.fn().mockResolvedValue({ "mother-in-law": {}, "don't": {} });
  await expect(resolveWordQuery("mother-in-law", api(lookup))).resolves.toBeDefined();
  await expect(resolveWordQuery("don't", api(lookup))).resolves.toBeDefined();
});

it("lowercases the lookup key so a proper noun reaches the trimmed ECDICT", async () => {
  const lookup = vi.fn().mockResolvedValue({ america: { ecdict: { word: "America", translation: "n. 美国" } } });
  const result = await resolveWordQuery("America", api(lookup));
  expect(lookup).toHaveBeenCalledWith(["america"]);
  expect(result.status).toBe("success");
  expect(result.meaning).toContain("美国");
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run src/features/translation/dictionaryResolver.test.ts`
Expected: FAIL，报无法解析 `./dictionaryResolver`

- [x] **Step 3: 实现 `resolveWordQuery`**

一次把「原词 + 全部 `lemmaCandidates`」作为一个词表发出去，只做一次往返。候选命中后按优先级挑选并适配成现有 `DictionaryEntry` 结构，保证 UI 无需改动。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run src/features/translation/dictionaryResolver.test.ts`
Expected: PASS

- [x] **Step 5: 提交**

```bash
git add src/features/translation/dictionaryResolver.ts src/features/translation/dictionaryResolver.test.ts
git commit -m "feat: 新增查词策略层"
```

---

## Task 8: 策略层——中文反查排序

**Files:**
- Modify: `src/features/translation/dictionaryResolver.ts`
- Test: `src/features/translation/dictionaryResolver.test.ts`

**Interfaces:**
- Produces: `resolveChineseQuery(query: string, api: DictionaryAtomicApi, signal?: AbortSignal): Promise<WordQueryResult>`
- Produces: `REVERSE_LOOKUP_LIMIT = 6`

排序规则（设计文档 7.2）：依次比较英文词频序号（取自精简 ECDICT 的 `bnc`，无排名垫底）→ 来源顺序（CC-CEDICT 优先）→ 牛津义项位置 → 字母序。

> **实施时把排序规则整体换了，动手前先读。** 计划原定的「英文词频优先」实测不成立：「放弃」的前六条是 get、give、give、back、back、part——牛津的 get / give / back 各有上百个义项，某个次要义项里带过「放弃」，而它们的词频远高于 abandon。
>
> 换成**来源优先（CC-CEDICT → 牛津 → 精简 ECDICT），同来源内比词频**，并给没有词频的多词短语一个中位值 5000（否则「睡觉」的 go to bed、「生气」的 get angry 会被 vitality 这类冷门单词挤掉）。三套规则都用真实数据跑过十条查询对比，这一套是唯一能同时满足「放弃→abandon」「生气→短语在前」的。
>
> 顺带修了一处脆弱点：`server/ecdict.ts` 原先用 `import.meta.url` 拼词库路径，在 jsdom 测试环境下会抛「The URL must be of scheme file」。改成与 `server/oxford.ts` 一致的 `process.cwd()` 写法。
>
> 测试里有一组真实数据回归（放弃、跑步、提高、睡觉、银行、猫、电脑断言首条；放弃断言 abandon 与 give up 同屏；骚扰断言含 harass），改排序后若变红说明反查质量下降。

- [x] **Step 1: 写失败测试**

```ts
it("puts abandon first for 放弃", async () => {
  const result = await resolveChineseQuery("放弃", cedictApi);
  expect(result.panels[0].body.split("、")[0]).toBe("abandon");
});

it("pushes the rare senses of 猫 out of the top six", async () => {
  const result = await resolveChineseQuery("猫", cedictApi);
  const words = result.panels[0].body.split("、");
  expect(words).toContain("cat");
  expect(words).not.toContain("modem");
});

it("applies the six entry limit", async () => {
  const result = await resolveChineseQuery("提高", cedictApi);
  expect(result.panels[0].body.split("、").length).toBeLessThanOrEqual(6);
});
```

`cedictApi` 是本任务测试内的固定装置：`reverseLookup` 返回真实的 CC-CEDICT 与牛津命中，`lookupWords` 返回真实 BNC 词频供排序使用。装置里的词频必须反映真实差距——`abandon` 显著小于 `renounce`，`modem` 显著大于 `cat`；凭空编造的词频会让这组测试失去意义。

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run src/features/translation/dictionaryResolver.test.ts`
Expected: FAIL，`resolveChineseQuery is not a function`

- [x] **Step 3: 实现 `resolveChineseQuery` 与排序**

三个来源合并去重后按上述规则排序，截取前 `REVERSE_LOOKUP_LIMIT` 条，拼进 `panels[0].body`，分隔符沿用现有的 `、`。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run src/features/translation/dictionaryResolver.test.ts`
Expected: PASS

- [x] **Step 5: 补一组真实数据回归用例**

对 `放弃`、`骚扰`、`跑步`、`提高`、`睡觉`、`银行`、`猫` 断言首条命中。这组用例是设计文档十二节第 4 项要求的固定回归集，将来改动若让「放弃」丢掉 abandon 或让「骚扰」丢掉 harass，必须让测试报红。

- [x] **Step 6: 提交**

```bash
git add src/features/translation/dictionaryResolver.ts src/features/translation/dictionaryResolver.test.ts
git commit -m "feat: 新增中文反查排序策略"
```

---

## Task 9: 接入查词与反查界面路径

**Files:**
- Modify: `src/features/translation/dictionaryProvider.ts`
- Modify: `src/features/translation/translationService.ts`
- Modify: `src/features/vocabulary/VocabularyPage.tsx`
- Test: `src/features/translation/dictionaryProvider.test.ts`、`src/features/translation/desktopProviders.test.ts`

**Interfaces:**
- Consumes: Task 7 的 `resolveWordQuery`、Task 8 的 `resolveChineseQuery`
- Produces: `createBrowserDictionaryApi()` 与 `createDesktopDictionaryApi()` 两个 `DictionaryAtomicApi` 实现

> **实施时的四处偏离，动手前先读：**
>
> 1. `dictionaryProvider.ts` 被整体重写：`loadInstalledDictionaryResult` 删除，改为导出 `createBrowserDictionaryApi`、`createDesktopDictionaryApi`、`createDictionaryApi` 与 `usesDesktopBackend`。原来的合流逻辑（把牛津例句与搭配并进 ECDICT 条目）已经是 Task 7 策略层的职责。
> 2. **补了 `/api/dictionary-lemmas` 接口。** Task 6 的开发服务器只加了 lookup 与 reverse 两个，但 Task 10 的阅读页词族需要 lemma；三者同属原子查询层，补在这里比另开一处合理。
> 3. **`VocabularyPage.tsx` 没有改。** 它用的 `/api/local-dictionary` 是刻意保留的音标链路接口，行为不变。它那个「刷新旧收藏释义」的路径在桌面版本来就取不到数据（没有开发服务器），不是本次引入的。
> 4. 既有测试全部改成新接口的形状。其中「中文查询返回多个候选」的断言从 `entries` 改成候选列表——这是设计文档 7.2 的既定变化：中文反查返回候选词，不再把第一个候选的释义当结果。
>
> 一条值得记下的证据：只是往测试打桩里多加了一个 `britishPhonetic` 字段，两个音标用例就红了。这从反面证明「音标来源按平台各走原路」不是纸上谈兵，动它立刻会显形。

- [x] **Step 1: 写失败测试**

在 `desktopProviders.test.ts` 增加：桌面版对 `bank` 的查询走 `desktop_dictionary_lookup`（批量命令）而不是旧的 `desktop_dictionary`；开发版走 `/api/dictionary-lookup`。

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run src/features/translation/desktopProviders.test.ts`
Expected: FAIL，断言的是新命令名但实现仍在调用旧命令

- [x] **Step 3: 实现两个 API 适配器并接到 `resolveQuery`**

桌面判定沿用现有 `isTauri() && hostname 非 localhost` 的条件。`resolveQuery` 内部改为调用策略层，返回结构保持不变。

- [x] **Step 4: 运行相关测试确认通过**

Run: `pnpm vitest run src/features/translation src/features/vocabulary src/features/home`
Expected: PASS

- [x] **Step 5: 确认音标链路未被波及**

Run: `pnpm vitest run src/features/translation/pronunciationService.test.ts`
Expected: PASS，且该文件未被修改（用 `git diff --stat` 确认它不在改动列表里）

- [x] **Step 6: 提交**

```bash
git add src/features/translation src/features/vocabulary
git commit -m "feat: 查词与反查改走新的词典策略层"
```

---

## Task 10: 阅读页词族接入

**Files:**
- Modify: `src/features/reading/wordFamilyStore.ts`
- Modify: `src/features/reading/wordMatch.ts`
- Test: `src/features/reading/wordFamilyStore.test.ts`（新建）、`src/features/reading/wordMatch.test.ts`

**Interfaces:**
- Consumes: Task 6 的 `lookupLemmas`、Task 5 的 `lemmaCandidates`
- Produces: 词族来源改为「牛津 lemma 表 + 不规则表 + 规则候选」，桌面版不再依赖只有开发服务器才存在的 `/api/word-family`

> **实施时的三点说明，动手前先读：**
>
> 1. 应用侧**不再调用 `/api/word-family`**。那个接口与 `server/ecdict.ts` 的 `queryWordFamily` 仍保留（有测试覆盖，且删它要连带清理 server 代码），但已成为死路径。要清理由后续单独决定。
> 2. **牛津的 lemma 表是「变形 → 原形」方向**（run→ran、go→went、knife→knives），反向用（给原形列出全部变形）需要另写一次查询，本次没加。本地不规则表覆盖了常见情形，而且在 `children`、`mice`、`better` 这几个词上比牛津更全——牛津根本不收 `children`。这是已知的覆盖取舍，不是遗漏。
> 3. 抽出纯函数 `wordFamily(word, lemma?)` 便于测试；`loadWordFamilies` 在原子查询失败时只用本地规则，永不抛错，与迁移前的降级行为一致。

- [x] **Step 1: 写失败测试**

断言 `loadWordFamilies(["ran","children"])` 在桌面环境（无 `/api/word-family`）下也能返回 `{ ran: [...,"run"], children: [...,"child"] }`，并且缓存键与现有 `WORD_FAMILY_STORAGE_KEY` 兼容。

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run src/features/reading/wordFamilyStore.test.ts`
Expected: FAIL

- [x] **Step 3: 改造 `wordFamilyStore`**

先读缓存，再对缺失词调用 `lookupLemmas`，把原形与 `lemmaCandidates` 的规则候选合并后写入缓存。请求失败时退回纯规则层，与现状行为一致。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run src/features/reading`
Expected: PASS

- [x] **Step 5: 提交**

```bash
git add src/features/reading
git commit -m "feat: 阅读页词族改走新的词形还原来源"
```

---

## Task 11: 打包配置与路径解析

> **实施时的两点补充：**
>
> - `tauri.conf.json` 的 `resources` 由单条改为三条（精简 ECDICT、牛津主库、CC-CEDICT 索引），映射名仍是 `dictionaries/stardict.db`、`dictionaries/landict-oxford.db`、`dictionaries/landict-cedict.db`。Rust 侧的路径解析与回退分支在 Task 6 就已按这三条写好，本次只补了缺文件用例。
> - 设置页「关于」区块新增一行「词典数据」，写明四个来源与许可。这一行同时是 CC-CEDICT 的 CC BY-SA 4.0 署名位置，删掉会违反许可，测试已锁定它存在。
>
> Task 12（构建安装包并在真机验证）按使用者指示跳过——桌面版随时可以从源码重建，不需要在这里做。

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/src/desktop_queries.rs`
- Modify: `.gitignore`（新增 `data/oxford-sqlite/`、`data/cedict-sqlite/`）
- Modify: `src/features/settings/SettingsPage.tsx`（「关于」区块新增词典来源说明）
- Test: `src/features/settings/SettingsPage.test.tsx`

- [x] **Step 1: 改打包资源映射**

把 `resources` 由单条 `{"../data/ecdict-sqlite-28/stardict.db": "dictionaries/stardict.db"}` 改为三条：精简 `stardict.db`、`landict-oxford.db`、`landict-cedict.db`，全部映射到 `dictionaries/` 下。牛津 `.mdx`/`.mdd` 原件与完整 ECDICT 均不进入安装包。

- [x] **Step 2: 更新 `.gitignore`**

`data/oxford-sqlite/` 与 `data/cedict-sqlite/` 已在 Task 1 加入 `.gitignore`，此处只需确认两条规则仍在，且 `data/cedict/cedict.txt` 未被忽略。

- [x] **Step 3: 在设置页「关于」区块注明词典数据来源**

CC BY-SA 4.0 要求署名。在 `SettingsPage` 现有的 `<SettingsSection title="关于">` 里，按既有 `settings-row` 结构新增一行「词典数据」，写明四个来源：牛津高阶双解（英文释义与例句）、Merriam-Webster's Collegiate（美式音频）、ECDICT（兜底词库，MIT）、CC-CEDICT（中文反查，CC BY-SA 4.0）。在 `SettingsPage.test.tsx` 断言这一行存在且含 `CC-CEDICT`。

- [x] **Step 4: 确认路径回退分支**

在 `desktop_queries.rs` 里确认三个库各自有「`resource_dir()` 找不到 → `debug_assertions` 下回退仓库路径」的处理，并且缺文件时返回空结果而不是 panic。

- [x] **Step 5: 补一条 Rust 测试**

断言词库文件不存在时命令返回空结果且不 panic。

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS

- [x] **Step 6: 运行全量测试**

Run: `pnpm test`
Expected: 全部 PASS。这是 Global Constraints 要求的全量测试，本次涉及数据层与打包配置。

- [x] **Step 7: 提交**

```bash
git add src-tauri/tauri.conf.json src-tauri/src/desktop_queries.rs .gitignore src/features/settings
git commit -m "feat: 打包精简词库并更新资源映射"
```

---

## Task 12: 安装版实测与体积确认

**Files:**
- 无源码改动；产出验证记录，写入 `docs/superpowers/plans/2026-10-08-oxford-primary-dictionary.md` 末尾的验证小节

**Interfaces:**
- Consumes: Task 11 的打包配置

- [ ] **Step 1: 构建安装包**

Run: `pnpm tauri build`
Expected: 构建成功，`src-tauri/target/release/bundle/` 下出现安装产物。

- [ ] **Step 2: 记录词库部分体积**

列出安装产物中 `dictionaries/` 三个文件的字节数，与设计文档第二节的 43 MiB 对比。若明显超出，先查是哪一份产物偏大。

- [ ] **Step 3: 实际安装并逐项验证**

在独立目录安装，确认：程序能启动；查 `cat` 返回牛津释义与例句；查 `America` 走精简 ECDICT 兜底并有中文；查 `qqxzvnotaword` 显示「未收录」；中文反查 `放弃` 首条为 `abandon`；阅读页保存 `run` 后文中 `ran` 高亮。

- [ ] **Step 4: 比对音标与音频未被改动**

在安装版里查 `schedule`，确认英式与美式音标文本、音频来源标记与改动前一致。这是设计文档第八节的硬边界。

- [ ] **Step 5: 记录验证结果并提交**

把实际体积与逐项结果写进本计划末尾，然后：

```bash
git add docs/superpowers/plans/2026-10-08-oxford-primary-dictionary.md
git commit -m "docs: 记录词库更换后的安装版验证结果"
```

---

## 验证记录

（Task 12 完成后填写实际体积与逐项结果。）

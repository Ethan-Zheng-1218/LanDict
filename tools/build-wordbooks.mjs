/**
 * 从 ECDICT 源库抽取考试词库。只在需要重新生成时才跑：
 *   node tools/build-wordbooks.mjs
 *
 * 输出 `public/wordbooks/<id>.json`，前端直接 fetch 就能用。
 * **这份产物已经生成好并提交进 Git 了**：应用和安装包都用它，日常不需要重跑本脚本。
 *
 * 它需要一个本地原料 `data/ecdict-sqlite-28/stardict.db`（812 MiB），原因是
 * 考试标签（四级/六级/考研…）只存在那份源库里 —— 精简库在构建时把 `tag` 列丢掉了。
 * 这份原料不在仓库里、也不进安装包，脚本只读它、不改它；缺了它脚本会直接跳过并说明，
 * 不会报错。只有要改抽取口径（换过滤规则、加新词库）时才需要把它放回来。
 */

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(resolve(process.cwd(), "package.json"));
const { DatabaseSync } = require("node:sqlite");

const ROOT = process.cwd();
export const ECDICT_SOURCE_PATH = resolve(ROOT, "data/ecdict-sqlite-28/stardict.db");
const OUTPUT_DIR = resolve(ROOT, "public/wordbooks");

/** 按考试标签分库。tag 是空格分隔的多值字段，`LIKE '%cet4%'` 就是"含 cet4 标签"。 */
export const TAG_BOOKS = [
  { id: "cet4", name: "四级", tag: "cet4" },
  { id: "cet6", name: "六级", tag: "cet6" },
  { id: "ky", name: "考研", tag: "ky" },
  { id: "gk", name: "高考", tag: "gk" },
  { id: "ielts", name: "雅思", tag: "ielts" },
  { id: "toefl", name: "托福", tag: "toefl" },
  { id: "gre", name: "GRE", tag: "gre" },
];

/** 生活高频：不靠考试标签，按 BNC 词频取最常见的 N 个词。 */
export const CORE_BOOK = { id: "core", name: "生活高频", bncMax: 3000 };

/** 词表只收单个英文单词；带空格的词组归词组库，不在这里。 */
const SINGLE_WORD = /^[a-zA-Z][a-zA-Z'-]*$/;

/**
 * 「纯变形」的判据：释义只是在说"它是某某的变形"。
 *
 * 不能按 `exchange` 里的 `0:` 标记来过滤 —— 实测那批多数是独立实词：
 * `saw`（锯子）、`found`（建立）、`data`、`scissors`、`better`、`gone` 都带 `0:`，
 * 按标记过滤会把它们误删。反过来，真正只有变形义的条目（`ran` → run的过去式、
 * `studies` → （study的复数））几乎都命中下面这个句式。
 *
 * 已知代价：`being` 这种"实词顺带标注了变形"的会被误删（释义里带 be的现在分词）。
 * 四六级里只有个位数，接受。
 */
const POINTER = /的(过去式|过去分词|现在分词|复数|第三人称单数|比较级|最高级)/;

export function isPureInflection(translation) {
  const firstLine = (translation ?? "").split("\n")[0];
  return POINTER.test(firstLine);
}

/** 按词频升序（bnc 序号越小越常用），没有词频的排最后，同频按字母。 */
const ORDER_BY = "ORDER BY coalesce(nullif(bnc, 0), 9999999), coalesce(nullif(frq, 0), 9999999), word";

function collectByTag(db, tag) {
  return db
    .prepare(
      `SELECT word, translation FROM stardict
       WHERE tag LIKE ? AND translation IS NOT NULL AND length(translation) > 0
       ${ORDER_BY}`,
    )
    .all(`%${tag}%`);
}

function collectByFrequency(db, bncMax) {
  return db
    .prepare(
      `SELECT word, translation FROM stardict
       WHERE bnc BETWEEN 1 AND ? AND translation IS NOT NULL AND length(translation) > 0
       ${ORDER_BY}`,
    )
    .all(bncMax);
}

/** 过滤、去重、保序。返回 { words, droppedInflection, droppedNotWord }。 */
export function normalizeRows(rows) {
  const words = [];
  const seen = new Set();
  let droppedInflection = 0;
  let droppedNotWord = 0;
  for (const row of rows) {
    const word = (row.word ?? "").trim();
    if (!SINGLE_WORD.test(word)) {
      droppedNotWord += 1;
      continue;
    }
    if (isPureInflection(row.translation)) {
      droppedInflection += 1;
      continue;
    }
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(word);
  }
  return { words, droppedInflection, droppedNotWord };
}

export function buildWordbooks(sourcePath = ECDICT_SOURCE_PATH, outputDir = OUTPUT_DIR) {
  const db = new DatabaseSync(sourcePath, { readOnly: true });
  mkdirSync(outputDir, { recursive: true });

  const books = [];
  for (const book of [...TAG_BOOKS, CORE_BOOK]) {
    const rows = book.tag ? collectByTag(db, book.tag) : collectByFrequency(db, book.bncMax);
    const { words, droppedInflection, droppedNotWord } = normalizeRows(rows);
    const payload = { id: book.id, name: book.name, count: words.length, words };
    const file = resolve(outputDir, `${book.id}.json`);
    writeFileSync(file, `${JSON.stringify(payload)}\n`, "utf8");
    books.push({
      id: book.id,
      name: book.name,
      count: words.length,
      matched: rows.length,
      droppedInflection,
      droppedNotWord,
      bytes: statSync(file).size,
    });
  }
  db.close();

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: { path: "data/ecdict-sqlite-28/stardict.db", bytes: statSync(sourcePath).size },
    note: "考试标签只有源库里有；产物随前端打包，源库不打包，构建完可以删除。",
    books,
  };
  writeFileSync(resolve(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("tools/build-wordbooks.mjs") ?? false;

if (isMain) {
  if (!existsSync(ECDICT_SOURCE_PATH)) {
    // 和精简 ECDICT 一样：这份 812 MiB 的源库是本地原料，不进仓库也不进安装包，
    // 考试标签只有它有。产物已经生成并提交在 public/wordbooks/，平时不需要重跑；
    // 只有要改口径（比如换过滤规则、加新词库）时才需要把源库放回来。
    console.log(`跳过生成词库：源库不在（${ECDICT_SOURCE_PATH}）。`);
    console.log("public/wordbooks/ 里已经有一份提交好的产物，应用和打包都用它。");
    process.exit(0);
  }
  const manifest = buildWordbooks();
  const total = manifest.books.reduce((sum, book) => sum + book.count, 0);
  const bytes = manifest.books.reduce((sum, book) => sum + book.bytes, 0);
  console.log(`词库产物：${manifest.books.length} 个库，共 ${total.toLocaleString()} 个词，${(bytes / 1024).toFixed(0)} KB`);
  for (const book of manifest.books) {
    console.log(
      `  ${book.name.padEnd(6)}${String(book.count).padStart(6)} 词`
      + `（命中 ${book.matched}，去掉纯变形 ${book.droppedInflection}，去掉非单词 ${book.droppedNotWord}）`,
    );
  }
}

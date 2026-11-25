/**
 * 从牛津高阶双解库抽词组库。用法：
 *   node tools/build-phrasebooks.mjs
 *
 * 只读 `data/oxford-sqlite/landict-oxford.db`（这份是要打包的库之一），
 * 输出 `public/wordbooks/<id>.json`，与考试词库同一套格式、同一个目录。
 *
 * 三个来源都是库里的现成字段：
 *   idiom     —— 【IDIOMS】区，释义里 `◘ 短语 • 英文解释` 的 `•` 前半段
 *   colloc    —— 搭配字段
 *   multiword —— 词条本身就是多词的（above board 之类）
 */

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(resolve(process.cwd(), "package.json"));
const { DatabaseSync } = require("node:sqlite");

const ROOT = process.cwd();
const SOURCE = resolve(ROOT, "data/oxford-sqlite/landict-oxford.db");
const OUTPUT_DIR = resolve(ROOT, "public/wordbooks");

/**
 * 清掉词典排版留下的标注：`◘`、`•` 之后的内容、行首的 `7` 和序号，
 * 以及用 `'` 表示的重音（但不碰 sb's / don't / o'clock 这类真撇号）。
 */
export function cleanPhrase(raw) {
  return raw
    .replace(/[◘▪]/g, " ")
    .split("•")[0]
    .replace(/^\s*\d+\.?\s*/, "")
    .replace(/^\s*7\s*/, "")
    .replace(/([a-z])'(?!(?:s|t|re|ve|ll|d|m)\b)/gi, "$1")
    // 空格后面跟一个撇号是重音符号（a 'dog's life），不是撇号本身。
    .replace(/(\s)'(?=[a-z])/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const PHRASE_SHAPE = /^[a-z][a-z' -]*$/;

function collect(rows, pick) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    for (const raw of pick(row)) {
      const phrase = cleanPhrase(raw ?? "");
      if (phrase.length < 3 || phrase.length > 42) continue;
      if (!PHRASE_SHAPE.test(phrase) || !phrase.includes(" ")) continue;
      const key = phrase.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(phrase);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function buildPhrasebooks(sourcePath = SOURCE, outputDir = OUTPUT_DIR) {
  if (!existsSync(sourcePath)) {
    console.log(`跳过生成词组库：牛津库不在（${sourcePath}）。`);
    return null;
  }
  const db = new DatabaseSync(sourcePath, { readOnly: true });
  mkdirSync(outputDir, { recursive: true });

  const idiomRows = db
    .prepare('SELECT senses FROM entry WHERE senses LIKE ?')
    .all('%' + String.fromCharCode(34) + "idiom" + String.fromCharCode(34) + ":true%")
    .flatMap((row) => {
      try {
        return JSON.parse(row.senses)
          .filter((sense) => sense.idiom)
          .map((sense) => sense.definition ?? "");
      } catch {
        return [];
      }
    });

  const collocationRows = db
    .prepare("SELECT collocations FROM entry WHERE collocations != ? AND collocations != ?")
    .all("[]", "")
    .flatMap((row) => {
      try {
        return JSON.parse(row.collocations);
      } catch {
        return [];
      }
    });

  const multiwordRows = db
    .prepare("SELECT word FROM entry WHERE word LIKE ?")
    .all("% %")
    .map((row) => row.word)
    .filter((word) => /^[a-z]/.test(word) && !/[0-9()=]/.test(word));

  db.close();

  const books = [
    { id: "idiom", name: "固定习语", words: collect(idiomRows, (item) => [item]) },
    { id: "colloc", name: "常见搭配", words: collect(collocationRows, (item) => [item]) },
    { id: "multiword", name: "多词词条", words: collect(multiwordRows, (item) => [item]) },
  ];

  const manifest = [];
  for (const book of books) {
    const file = resolve(outputDir, `${book.id}.json`);
    writeFileSync(file, `${JSON.stringify({ id: book.id, name: book.name, count: book.words.length, words: book.words })}\n`, "utf8");
    manifest.push({ id: book.id, name: book.name, count: book.words.length, bytes: statSync(file).size });
  }
  console.log(`词组库：${manifest.map((book) => `${book.name} ${book.count}`).join(" / ")}`);
  return manifest;
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("tools/build-phrasebooks.mjs") ?? false;
if (isMain) buildPhrasebooks();

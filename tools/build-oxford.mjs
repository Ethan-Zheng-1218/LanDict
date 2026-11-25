/**
 * 把牛津高阶双解 .mdx 转成主库。用法：
 *   node tools/build-oxford.mjs
 *
 * 只在构建期运行。运行期 Rust 仍只读 SQLite，不引入 MDX 解析依赖。
 * 本文件不读取也不写入音标，音标链路见 server/oxford.ts。
 */

import { mkdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { extractHanziIndex, parseOxfordEntry } from "./oxford-build.mjs";

const require = createRequire(resolve(process.cwd(), "package.json"));
const { Mdx } = require("@runer-hq/mdict");
const { DatabaseSync } = require("node:sqlite");

const root = process.cwd();
const SOURCE_PATH = resolve(
  root,
  "data/牛津高阶双解 Oxford Advanced Learner's English-Chinese Dictionary 7th.mdx",
);
const TARGET_PATH = resolve(root, "data/oxford-sqlite/landict-oxford.db");
const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("tools/build-oxford.mjs") ?? false;

/** 低于这些值说明解析口径已失效，宁可让构建失败也不要产出残次主库。 */
const MINIMUM_ENTRIES = 42_000;
const MINIMUM_HANZI = 100_000;

export function buildOxfordDatabase(sourcePath = SOURCE_PATH, targetPath = TARGET_PATH) {
  const dictionary = new Mdx(sourcePath);
  const merged = new Map();
  const lemmas = new Map();

  // 牛津存在仅大小写不同的同形条目（A 与 a、US 与 us），主键是 NOCASE，
  // 因此必须先按小写归并，否则插入时会撞 UNIQUE 约束。
  for (const keyword of dictionary.listKeywords()) {
    const entry = parseOxfordEntry(dictionary.fetch(keyword).definition ?? "", keyword.keyText);
    if (entry.lemmaBase) lemmas.set(keyword.keyText, entry.lemmaBase);
    const key = entry.word.toLowerCase();
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, entry);
      continue;
    }
    existing.senses.push(...entry.senses);
    for (const collocation of entry.collocations) {
      if (!existing.collocations.includes(collocation)) existing.collocations.push(collocation);
    }
    Object.assign(existing.collocationTranslations, entry.collocationTranslations);
    for (const example of entry.examples) {
      if (!existing.examples.some((item) => item.text === example.text)) existing.examples.push(example);
    }
    if (!existing.pos) existing.pos = entry.pos;
    if (!existing.lemmaBase && entry.lemmaBase) existing.lemmaBase = entry.lemmaBase;
  }

  const entries = [...merged.values()];
  const hanzi = extractHanziIndex(entries);
  if (entries.length < MINIMUM_ENTRIES) {
    throw new Error(`牛津只解析出 ${entries.length} 个词条，低于 ${MINIMUM_ENTRIES}`);
  }
  if (hanzi.length < MINIMUM_HANZI) {
    throw new Error(`中文索引只解析出 ${hanzi.length} 条，低于 ${MINIMUM_HANZI}`);
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  rmSync(targetPath, { force: true });
  const db = new DatabaseSync(targetPath);
  db.exec(`
    CREATE TABLE entry (
      word TEXT PRIMARY KEY COLLATE NOCASE,
      headword TEXT NOT NULL,
      pos TEXT NOT NULL DEFAULT '',
      senses TEXT NOT NULL,
      collocations TEXT NOT NULL DEFAULT '[]',
      collocation_translations TEXT NOT NULL DEFAULT '{}',
      examples TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE hanzi (
      term TEXT NOT NULL,
      word TEXT NOT NULL,
      sense_index INTEGER NOT NULL
    );
    CREATE TABLE lemma (
      form TEXT PRIMARY KEY COLLATE NOCASE,
      base TEXT NOT NULL
    );
  `);

  const insertEntry = db.prepare("INSERT INTO entry VALUES (?, ?, ?, ?, ?, ?, ?)");
  const insertHanzi = db.prepare("INSERT INTO hanzi VALUES (?, ?, ?)");
  const insertLemma = db.prepare("INSERT INTO lemma VALUES (?, ?)");

  db.exec("BEGIN");
  for (const entry of entries) {
    insertEntry.run(
      entry.word,
      entry.headword,
      entry.pos,
      JSON.stringify(entry.senses),
      JSON.stringify(entry.collocations),
      JSON.stringify(entry.collocationTranslations),
      JSON.stringify(entry.examples),
    );
  }
  for (const item of hanzi) insertHanzi.run(item.term, item.word, item.senseIndex);
  for (const [form, base] of lemmas) insertLemma.run(form, base);
  db.exec("COMMIT");

  db.exec("CREATE INDEX idx_hanzi_term ON hanzi(term)");
  db.close();

  return {
    entries: entries.length,
    hanzi: hanzi.length,
    lemmas: lemmas.size,
    bytes: statSync(targetPath).size,
  };
}

if (isMain) {
  const result = buildOxfordDatabase();
  console.log(
    `牛津主库：${result.entries.toLocaleString()} 个词条，`
    + `${result.hanzi.toLocaleString()} 条中文索引，`
    + `${result.lemmas.toLocaleString()} 条变形指向，`
    + `${(result.bytes / 1024 / 1024).toFixed(1)} MiB`,
  );
}

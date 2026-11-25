/**
 * 把 CC-CEDICT 原始文本转成中文反查索引。用法：
 *   node tools/build-cedict.mjs
 *
 * 产物 data/cedict-sqlite/landict-cedict.db 属于 CC-CEDICT 的改编数据，
 * 按 CC BY-SA 4.0 提供，来源见 data/cedict/CC-CEDICT-LICENSE.txt。
 */

import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { parseCedictEntries, toReverseIndex } from "./cedict.mjs";

const require = createRequire(resolve(process.cwd(), "package.json"));
const { DatabaseSync } = require("node:sqlite");

const root = process.cwd();
const SOURCE_PATH = resolve(root, "data/cedict/cedict.txt");
const TARGET_PATH = resolve(root, "data/cedict-sqlite/landict-cedict.db");
const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("tools/build-cedict.mjs") ?? false;

/** 词条数低于这个值说明解析口径出错，宁可让构建失败也不要产出残次索引。 */
const MINIMUM_TERMS = 50_000;

export function buildCedictDatabase(sourcePath = SOURCE_PATH, targetPath = TARGET_PATH) {
  const index = toReverseIndex(parseCedictEntries(readFileSync(sourcePath, "utf8")));
  if (index.size < MINIMUM_TERMS) {
    throw new Error(`CC-CEDICT 索引只解析出 ${index.size} 个中文词，低于 ${MINIMUM_TERMS}，解析口径可能已失效`);
  }
  mkdirSync(dirname(targetPath), { recursive: true });
  rmSync(targetPath, { force: true });
  const db = new DatabaseSync(targetPath);
  db.exec("CREATE TABLE cedict(term TEXT NOT NULL, gloss TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO cedict VALUES (?, ?)");
  db.exec("BEGIN");
  for (const [term, glosses] of index) for (const gloss of glosses) insert.run(term, gloss);
  db.exec("COMMIT");
  db.exec("CREATE INDEX idx_cedict_term ON cedict(term)");
  db.close();
  return { terms: index.size, bytes: statSync(targetPath).size };
}

if (isMain) {
  const { terms, bytes } = buildCedictDatabase();
  console.log(`CC-CEDICT 索引：${terms.toLocaleString()} 个中文词，${(bytes / 1024 / 1024).toFixed(2)} MiB`);
}

/**
 * 把完整 ECDICT 精简成兜底词库。用法：
 *   node tools/build-ecdict.mjs
 *
 * 沿用表结构，不新建表、不改列，因此 server/ecdict.ts 与
 * src-tauri/src/desktop_queries.rs 里既有的查询语句全部无需改写。
 *
 * 保留口径：Collins 标记、牛津收录、BNC 词频前 50,000、词频序号前 50,000，
 * 再过滤完整英文词与空中文释义。实测保留 58,331 行（占 1.7%），
 * 但 BNC 前 50,000 词保留率是 100%。
 */

import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

// node:sqlite 是新内置模块，Vite 的内置清单里没有它，静态 import 会让 vitest
// 把它当普通包去解析并失败；import.meta.url 在 vitest 里也不是文件 URL。
// 两者都换成运行时取值，工具链就不会碰它们。
const require = createRequire(resolve(process.cwd(), "package.json"));
const { DatabaseSync } = require("node:sqlite");

const root = process.cwd();
export const SOURCE_PATH = resolve(root, "data/ecdict-sqlite-28/stardict.db");
/**
 * 精简库用独立文件名，不覆盖源库。
 * 实测 Windows 上有外部程序（杀毒或索引服务）长期持有 stardict.db 的句柄，
 * 改名与覆盖都会 EBUSY；独立文件名既绕开这个问题，也不会误删 812 MiB 的原始数据。
 */
export const SLIM_PATH = resolve(root, "data/ecdict-sqlite-28/stardict-slim.db");
const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("tools/build-ecdict.mjs") ?? false;

const KEEP_CONDITION =
  "coalesce(collins, 0) > 0 OR oxford = 1 OR bnc BETWEEN 1 AND 50000 OR frq BETWEEN 1 AND 50000";

/** BNC 前 50,000 词必须一条不漏，低于这个数说明筛选口径出错了。 */
export const MINIMUM_KEPT_ROWS = 58_000;
export const REQUIRED_BNC_TOP_50K = 45_443;

/**
 * 追加 bnc / frq 两列，放在既有六列之后。
 * 现有查询都用具名列（server/ecdict.ts 与 desktop_queries.rs 的 FIELDS），
 * 全仓库没有任何 `SELECT *`，所以追加列不会影响它们；
 * 而中文反查的排序规则要用 bnc 当英文词频，必须随精简库一起留下。
 */
const SLIM_COLUMNS = "word, phonetic, definition, translation, pos, exchange, bnc, frq";

/**
 * 显式声明列类型。不能靠字符串拼接推导——那样 bnc 会落成 TEXT，
 * 值变成 "2057.0" 这种字符串，排序与大小比较都会出问题。
 */
const SLIM_SCHEMA = `CREATE TABLE stardict(
  word TEXT,
  phonetic TEXT,
  definition TEXT,
  translation TEXT,
  pos TEXT,
  exchange TEXT,
  bnc REAL,
  frq REAL
)`;

export function buildSlimEcdict(sourcePath, targetPath) {
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const sourceRows = source.prepare("SELECT count(*) c FROM stardict").get().c;
  const rows = source
    .prepare(`SELECT ${SLIM_COLUMNS} FROM stardict WHERE ${KEEP_CONDITION}`)
    .all();
  source.close();

  mkdirSync(dirname(targetPath), { recursive: true });
  rmSync(targetPath, { force: true });
  const target = new DatabaseSync(targetPath);
  target.exec(SLIM_SCHEMA);
  const insert = target.prepare("INSERT INTO stardict VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  target.exec("BEGIN");
  for (const row of rows) {
    insert.run(row.word, row.phonetic, row.definition, row.translation, row.pos, row.exchange, row.bnc, row.frq);
  }
  target.exec("COMMIT");
  target.exec("CREATE INDEX stardict_word ON stardict(word)");
  target.exec("VACUUM");
  target.close();

  return { sourceRows, keptRows: rows.length, bytes: statSync(targetPath).size };
}

/**
 * 精简库必须完整覆盖源库里 BNC 前 50,000 的每一个词，且不留没有中文释义的行。
 * 覆盖判定要回源库取词表——精简库的 bnc 列只用于排序，不能凭它自证覆盖完整。
 */
export function assertSlimEcdict(sourcePath, targetPath) {
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const required = source
    .prepare("SELECT word FROM stardict WHERE bnc BETWEEN 1 AND 50000")
    .all()
    .map((row) => row.word);
  source.close();

  const db = new DatabaseSync(targetPath, { readOnly: true });
  const lookup = db.prepare("SELECT 1 FROM stardict WHERE word = ? COLLATE NOCASE LIMIT 1");
  const keptBnc = required.filter((word) => lookup.get(word)).length;
  const withoutChinese = db
    .prepare("SELECT count(*) c FROM stardict WHERE translation IS NULL OR length(translation) = 0")
    .get().c;
  db.close();

  if (keptBnc !== required.length) {
    throw new Error(`BNC 前 50,000 词只保留了 ${keptBnc} 条，应为 ${required.length} 条`);
  }
  if (withoutChinese !== 0) {
    throw new Error(`精简库里还有 ${withoutChinese} 行没有中文释义`);
  }
  return { keptBnc, expectedBnc: REQUIRED_BNC_TOP_50K, withoutChinese };
}

/** 构建精简库并断言覆盖完整。源库保持原样不动。 */
export function buildSlimEcdictFile(sourcePath = SOURCE_PATH, slimPath = SLIM_PATH) {
  const result = buildSlimEcdict(sourcePath, slimPath);
  assertSlimEcdict(sourcePath, slimPath);
  return { ...result, slimPath, bytes: statSync(slimPath).size };
}

if (isMain) {
  if (!existsSync(SOURCE_PATH)) {
    // 源库是 812 MiB 的一次性原料，`.gitignore` 里就没有它：不进仓库也不进安装包。
    // 精简库生成好之后（平时就是这样），应用和安装包都不需要它。
    console.log(`跳过重建精简 ECDICT：源库不在（${SOURCE_PATH}）。`);
    console.log(
      existsSync(SLIM_PATH)
        ? `现成的精简库还在，应用照常用它：${SLIM_PATH}`
        : `精简库也不在，需要先把源库放回来才能重建。`,
    );
  } else {
    const result = buildSlimEcdictFile();
    console.log(
      `精简 ECDICT：${result.sourceRows.toLocaleString()} -> ${result.keptRows.toLocaleString()} 行，`
      + `${(result.bytes / 1024 / 1024).toFixed(1)} MiB -> ${result.slimPath}`,
    );
  }
}

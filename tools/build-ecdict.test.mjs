import { expect, it } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertSlimEcdict, buildSlimEcdict, MINIMUM_KEPT_ROWS } from "./build-ecdict.mjs";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

const SOURCE = resolve(process.cwd(), "data/ecdict-sqlite-28/stardict.db");

/**
 * 源库是 812 MiB 的本地原料，`.gitignore` 里就没有它：既不进仓库也不进安装包，
 * 只在需要重建精简库时才用得着。所以没有它就跳过，而不是失败 ——
 * 否则任何一次干净克隆（或者删掉这份原料之后）都会平白多出两条红灯。
 */
const hasSource = existsSync(SOURCE);

it.skipIf(!hasSource)("keeps every headword the BNC ranks inside the top 50,000", () => {
  const target = join(mkdtempSync(join(tmpdir(), "landict-slim-")), "slim.db");
  const result = buildSlimEcdict(SOURCE, target);
  expect(result.keptRows).toBeGreaterThanOrEqual(MINIMUM_KEPT_ROWS);
  expect(assertSlimEcdict(SOURCE, target)).toEqual({
    keptBnc: 45_443,
    expectedBnc: 45_443,
    withoutChinese: 0,
  });
});

it.skipIf(!hasSource)("keeps the table shape and the frequency ranks the lookups rely on", () => {
  const target = join(mkdtempSync(join(tmpdir(), "landict-shape-")), "slim.db");
  buildSlimEcdict(SOURCE, target);
  const db = new DatabaseSync(target, { readOnly: true });
  const columns = db.prepare("PRAGMA table_info(stardict)").all().map((column) => column.name);
  const row = db.prepare("SELECT word, translation FROM stardict WHERE word = ? COLLATE NOCASE").get("cat");
  const rank = (word) => db.prepare("SELECT bnc FROM stardict WHERE word = ? COLLATE NOCASE").get(word)?.bnc ?? 0;
  const abandon = rank("abandon");
  const renounce = rank("renounce");
  db.close();
  expect(columns).toEqual(["word", "phonetic", "definition", "translation", "pos", "exchange", "bnc", "frq"]);
  expect(row.word).toBe("cat");
  // 中文反查靠这两个数字把 abandon 排在 renounce 前面。
  expect(abandon).toBeGreaterThan(0);
  expect(abandon).toBeLessThan(renounce);
});

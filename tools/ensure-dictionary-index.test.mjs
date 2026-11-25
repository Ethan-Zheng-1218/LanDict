// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { expect, it } from "vitest";
import { ensureDictionaryIndex } from "./ensure-dictionary-index.mjs";
const { DatabaseSync } = createRequire(resolve("package.json"))("node:sqlite");

it("upgrades existing dictionaries idempotently and uses an index for prefix and spelling candidates", () => {
  const root = mkdtempSync(join(tmpdir(), "landict-search-index-"));
  const path = join(root, "slim.db");
  const seed = new DatabaseSync(path);
  seed.exec("CREATE TABLE stardict(word TEXT, bnc REAL, frq REAL); INSERT INTO stardict VALUES ('capture', 1200.0, 0)");
  seed.close();
  try {
    ensureDictionaryIndex(path);
    ensureDictionaryIndex(path);
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      expect(db.prepare("PRAGMA index_list(stardict)").all()).toHaveLength(1);
      for (const [sql, args] of [["SELECT word FROM stardict WHERE word >= ? AND word < ?", ["capt", "capt{"]], ["SELECT word FROM stardict WHERE word IN (?, ?)", ["capture", "captuer"]]]) {
        const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map(row => row.detail).join(" ");
        expect(plan).toContain("SEARCH stardict");
        expect(plan).toContain("stardict_word");
      }
    } finally { db.close(); }
  } finally {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected fixture path");
    rmSync(root, { recursive: true, force: true });
  }
});

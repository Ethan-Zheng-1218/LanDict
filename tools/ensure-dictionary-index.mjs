import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(resolve(process.cwd(), "package.json"));
const { DatabaseSync } = require("node:sqlite");

/** Upgrade the generated slim dictionary in place; the original source is untouched. */
export function ensureDictionaryIndex(path = resolve("data/ecdict-sqlite-28/stardict-slim.db")) {
  if (!existsSync(path)) return false;
  const db = new DatabaseSync(path);
  try { db.exec("CREATE INDEX IF NOT EXISTS stardict_word ON stardict(word)"); }
  finally { db.close(); }
  return true;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("tools/ensure-dictionary-index.mjs")) {
  console.log(ensureDictionaryIndex() ? "Local dictionary search index ready." : "Local dictionary not present; input hints will be unavailable.");
}

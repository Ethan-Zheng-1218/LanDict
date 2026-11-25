/**
 * 词库统一构建入口。用法：
 *   node tools/build-dictionaries.mjs
 *
 * 依次构建三份产物并写入构建记录。任一项的行数低于断言值就以非零退出码结束。
 * 构建脚本只读源文件，不修改 data 下的原始词典。
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCedictDatabase } from "./build-cedict.mjs";
import { buildOxfordDatabase } from "./build-oxford.mjs";
import { buildSlimEcdictFile, SLIM_PATH as ECDICT_SLIM, SOURCE_PATH as ECDICT_SOURCE } from "./build-ecdict.mjs";
import { ensureDictionaryIndex } from "./ensure-dictionary-index.mjs";

const root = process.cwd();
const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("tools/build-dictionaries.mjs") ?? false;

const RECORD_PATH = resolve(root, "data/dictionary-build.json");
const OXFORD_SOURCE = resolve(
  root,
  "data/牛津高阶双解 Oxford Advanced Learner's English-Chinese Dictionary 7th.mdx",
);
const CEDICT_SOURCE = resolve(root, "data/cedict/cedict.txt");

/** 与设计文档第二节的实测值一致；低于它说明口径已失效，构建必须失败而不是产出残次产物。 */
const EXPECTED = {
  cedict: { label: "CC-CEDICT 反查索引", minimum: 90_000 },
  // 中文索引只收前三个非成语义项，实测 102,485 条；阈值取 100,000。
  oxford: { label: "牛津主库", minimum: 42_000, hanziMinimum: 100_000 },
  ecdict: { label: "精简 ECDICT", minimum: 58_000 },
};

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sourceInfo(path) {
  return { path: path.slice(root.length + 1), bytes: statSync(path).size, sha256: sha256(path) };
}

export function buildAllDictionaries() {
  const failures = [];
  const skipped = [];
  const products = {};

  const cedict = buildCedictDatabase();
  products.cedict = { rows: cedict.terms, bytes: cedict.bytes };
  if (cedict.terms < EXPECTED.cedict.minimum) {
    failures.push(`${EXPECTED.cedict.label}：${cedict.terms} 条中文词，低于 ${EXPECTED.cedict.minimum}`);
  }

  const oxford = buildOxfordDatabase();
  products.oxford = { rows: oxford.entries, hanziRows: oxford.hanzi, lemmaRows: oxford.lemmas, bytes: oxford.bytes };
  if (oxford.entries < EXPECTED.oxford.minimum) {
    failures.push(`${EXPECTED.oxford.label}：${oxford.entries} 个词条，低于 ${EXPECTED.oxford.minimum}`);
  }
  if (oxford.hanzi < EXPECTED.oxford.hanziMinimum) {
    failures.push(`${EXPECTED.oxford.label}：${oxford.hanzi} 条中文索引，低于 ${EXPECTED.oxford.hanziMinimum}`);
  }

  // 精简 ECDICT 的源库是 812 MiB 的一次性原料，不在仓库里（也不该进安装包）。
  // 有源库就重建；没有但已经有现成的精简库，就沿用它 —— 应用平时用的就是现成那份。
  if (existsSync(ECDICT_SOURCE)) {
    const ecdict = buildSlimEcdictFile();
    products.ecdict = { sourceRows: ecdict.sourceRows, rows: ecdict.keptRows, bytes: ecdict.bytes };
    if (ecdict.keptRows < EXPECTED.ecdict.minimum) {
      failures.push(`${EXPECTED.ecdict.label}：${ecdict.keptRows} 行，低于 ${EXPECTED.ecdict.minimum}`);
    }
  } else if (existsSync(ECDICT_SLIM)) {
    ensureDictionaryIndex(ECDICT_SLIM);
    products.ecdict = { rows: null, bytes: statSync(ECDICT_SLIM).size, reused: true };
    skipped.push(`${EXPECTED.ecdict.label}：源库不在，沿用现成的 ${ECDICT_SLIM.slice(root.length + 1)}`);
  } else {
    failures.push(`${EXPECTED.ecdict.label}：源库和精简库都不在，词库无法提供`);
  }

  const record = {
    generatedAt: new Date().toISOString(),
    sources: {
      cedict: sourceInfo(CEDICT_SOURCE),
      oxford: sourceInfo(OXFORD_SOURCE),
      // 源库不在时只记一笔"缺"，不去算它的 sha256（那是 812 MiB）。
      ecdict: existsSync(ECDICT_SOURCE)
        ? sourceInfo(ECDICT_SOURCE)
        : { path: ECDICT_SOURCE.slice(root.length + 1), missing: true },
    },
    products,
    totalBytes: Object.values(products).reduce((sum, product) => sum + product.bytes, 0),
    keepCondition:
      "coalesce(collins,0)>0 OR oxford=1 OR bnc BETWEEN 1 AND 50000 OR frq BETWEEN 1 AND 50000",
    failures,
    skipped,
  };
  writeFileSync(RECORD_PATH, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

if (isMain) {
  const record = buildAllDictionaries();
  for (const [key, product] of Object.entries(record.products)) {
    const rows = product.rows === null ? "沿用现成" : `${product.rows.toLocaleString()} 行`;
    console.log(`${key}: ${rows}，${(product.bytes / 1024 / 1024).toFixed(1)} MiB`);
  }
  for (const note of record.skipped) console.log(`跳过：${note}`);
  console.log(`合计 ${(record.totalBytes / 1024 / 1024).toFixed(1)} MiB，记录写入 ${RECORD_PATH}`);
  if (record.failures.length) {
    for (const failure of record.failures) console.error(`断言失败：${failure}`);
    process.exit(1);
  }
}

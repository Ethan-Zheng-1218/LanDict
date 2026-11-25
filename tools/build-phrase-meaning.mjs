/**
 * 用本地 Ollama 给词组库做两件事：清洗 + 生成例句，然后把结果写进 public/wordbooks/。
 *
 * 用法（要在 Ollama 开着的时候跑）：
 *   node tools/build-phrase-meaning.mjs            # 判分 + 生成例句 + 写文件
 *   node tools/build-phrase-meaning.mjs --write    # 只按已有进度重写 JSON，不再问模型
 *   node tools/build-phrase-meaning.mjs --limit 50 # 只处理前 N 条（试跑用）
 *
 * 进度写在 data/phrase-ai/ 下（judgments.jsonl / examples.jsonl），每处理一条就落盘，
 * 中断了再跑会自动接着做，不会白跑。
 *
 * 判据：
 *   固定习语 —— 全留（牛津 IDIOMS 区原文），只要求有中文释义；
 *   常见搭配 —— 严档：必须是固定搭配、意思不能从字面猜出来（约留 3%）；
 *   多词词条 —— 只留学习者真会遇到、且不能从字面猜出的词条（目标四成上下）。
 *
 * 例句：优先用牛津词条自带的例句（多词词条里约一成有），其余用本地模型生成，
 * 难度按"不低于雅思 6.5"来写；英文和中文分两次生成，中文质量更稳。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { cleanPhrase } from "./build-phrasebooks.mjs";

const require = createRequire(resolve(process.cwd(), "package.json"));
const { DatabaseSync } = require("node:sqlite");

const OXFORD_PATH = resolve(process.cwd(), "data/oxford-sqlite/landict-oxford.db");
const OUTPUT_DIR = resolve(process.cwd(), "public/wordbooks");
const STATE_DIR = resolve(process.cwd(), "data/phrase-ai");
const JUDGMENT_LOG = resolve(STATE_DIR, "judgments.jsonl");
const EXAMPLE_LOG = resolve(STATE_DIR, "examples.jsonl");
const OLLAMA = "http://127.0.0.1:11434/api/generate";
const MODEL = "qwen3.5:4b";
/** 判分/生成的并发：本地显卡串行更快，2 只是让网络往返不空转。 */
const CONCURRENCY = 2;

const args = process.argv.slice(2);
const writeOnly = args.includes("--write");
const dryRun = args.includes("--dry");
const limitIndex = args.indexOf("--limit");
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) || 0 : 0;

/* ── 提示词 ───────────────────────────────────────────── */

const COLLOC_PROMPT = [
  "你在给中国学生编一份很严格的英语搭配词库，宁缺毋滥。",
  "只有满足下面全部条件才收：",
  "① 是固定的习惯搭配（动宾、介副、固定说法），不是临时拼出来的描述；",
  "② 意思不能从字面直接猜出来（take account of = 考虑到；a calculated risk = 明知有风险仍要冒）；",
  "③ 雅思写作或口语里真的用得上。",
  "只要有一条不满足就 false：heavy rain、make a decision、a baby elephant、a bunch of grapes、a curtain pole 都是 false。",
  '只输出 JSON：{"keep":true 或 false}',
].join("\n");

const MULTIWORD_PROMPT = [
  "你在给中国学生挑多词词条，只收学习者真会遇到、值得记的固定表达或术语。",
  "两个问题都要过得去：① 学习者在雅思级别的材料里会真的遇到它吗？② 它的意思是不是不能从组成部分直接猜出来？",
  "收：above board、bad hair day、conscientious objector、credit transfer。",
  "不收：toffee apple、apple-pie bed、candy apple、assistant professor、art form（太具体或字面就能懂）。",
  '只输出 JSON：{"keep":true 或 false}',
].join("\n");

const EXAMPLE_PROMPT = [
  "你是英语学习词典的编辑。为下面这条短语写一条英文例句。",
  "要求：难度不低于雅思 6.5 学习者能读懂的表达；长度 10~18 个词；必须真正体现这条短语的用法。",
  '只输出 JSON：{"en":"..."}',
].join("\n");

const TRANSLATE_PROMPT = [
  "把下面这句英文翻译成自然、准确的中文，像词典例句的翻译那样简洁。",
  '只输出 JSON：{"cn":"..."}，中文里不要出现英文单词。',
].join("\n");

/* ── 模型调用 ─────────────────────────────────────────── */

async function askModel(prompt, numPredict = 120, attempt = 0) {
  try {
    const response = await fetch(OLLAMA, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        format: "json",
        think: false,
        options: { temperature: 0.2 + attempt * 0.2, num_predict: numPredict },
      }),
      signal: AbortSignal.timeout(60000),
    });
    const payload = await response.json();
    return JSON.parse(payload.response ?? "{}");
  } catch (error) {
    if (attempt < 2) return askModel(prompt, numPredict, attempt + 1);
    throw error;
  }
}

/* ── 从牛津库取出词组的释义与自带例句 ─────────────────── */

function collectSources() {
  const db = new DatabaseSync(OXFORD_PATH, { readOnly: true });
  const rows = db
    .prepare("SELECT word, senses, collocations, collocation_translations, examples FROM entry")
    .all();
  db.close();

  const idiom = new Map();
  const collocation = new Map();
  const entry = new Map();
  for (const row of rows) {
    const word = String(row.word);
    let senses = [];
    let collocations = [];
    let translations = {};
    let examples = [];
    try {
      senses = JSON.parse(row.senses ?? "[]");
      collocations = JSON.parse(row.collocations ?? "[]");
      translations = JSON.parse(row.collocation_translations ?? "{}");
      examples = JSON.parse(row.examples ?? "[]");
    } catch {
      continue;
    }
    entry.set(word.toLowerCase(), { word, senses, examples });

    for (const sense of senses) {
      if (!sense.idiom) continue;
      const raw = String(sense.definition ?? "");
      /* 和挑词组库时同一套清洗：`◘ 短语 • 英文解释` 取 • 前面那段 */
      const phrase = cleanPhrase(raw.split("•")[0] ?? "");
      const english = cleanPhrase(raw.split("•")[1] ?? "");
      const key = phrase.toLowerCase();
      if (phrase.includes(" ") && sense.translation) {
        const current = idiom.get(key);
        if (!current || (!current.en && english)) idiom.set(key, { cn: String(sense.translation).trim(), en: english });
      }
    }

    for (const phrase of collocations) {
      const key = String(phrase).trim().toLowerCase();
      const cn = translations?.[phrase];
      if (key && !collocation.has(key)) {
        collocation.set(key, {
          cn: typeof cn === "string" ? cn.trim() : "",
          /* 搭配自己的例句：父词条例句里包含这个短语的那一条 */
          example: examples.find((item) => String(item.text ?? "").toLowerCase().includes(key)) ?? null,
        });
      }
    }
  }
  return { idiom, collocation, entry };
}

function ownExample(sources, phrase) {
  const own = sources.entry.get(phrase.toLowerCase());
  if (!own) return null;
  const match = (own.examples ?? []).find((item) => String(item.text ?? "").toLowerCase().includes(phrase.toLowerCase()));
  const picked = match ?? (own.examples ?? [])[0];
  if (!picked?.text) return null;
  return { en: String(picked.text).trim(), cn: String(picked.translation ?? "").trim(), source: "oxford" };
}

/** 一条词组的来源信息：中文释义、习语的英文解释、牛津自带例句。 */
function meaningOf(sources, phrase) {
  const key = phrase.toLowerCase();
  const fromCollocation = sources.collocation.get(key)?.cn ?? "";
  const idiom = sources.idiom.get(key);
  const own = sources.entry.get(key);
  const fromEntry = (own?.senses ?? [])
    .filter((sense) => !sense.idiom && sense.translation)
    .map((sense) => sense.translation)
    .join("；");
  return {
    cn: fromCollocation || idiom?.cn || fromEntry || "",
    en: idiom?.en ?? "",
  };
}

/* ── 进度文件 ─────────────────────────────────────────── */

function readLog(path) {
  const map = new Map();
  if (!existsSync(path)) return map;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      map.set(record.phrase, record);
    } catch {
      /* 半截的一行忽略 */
    }
  }
  return map;
}

function appendLog(path, record) {
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
}

/** 带并发的顺序处理，每完成一条就回调（并发只用来藏网络延迟）。 */
async function runPool(items, worker, onProgress) {
  let index = 0;
  let done = 0;
  const runners = Array.from({ length: CONCURRENCY }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await worker(item);
      done += 1;
      onProgress(done, items.length, item);
    }
  });
  await Promise.all(runners);
}

/* ── 主流程 ───────────────────────────────────────────── */

async function main() {
  mkdirSync(STATE_DIR, { recursive: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const sources = collectSources();
  const judgments = readLog(JUDGMENT_LOG);
  const examples = readLog(EXAMPLE_LOG);

  const books = [
    { id: "idiom", name: "固定习语", pool: sources.idiom, judge: null, limit: Infinity },
    { id: "colloc", name: "常见搭配", pool: sources.collocation, judge: COLLOC_PROMPT, limit: Infinity },
    { id: "multiword", name: "多词词条", pool: null, judge: MULTIWORD_PROMPT, limit: Infinity },
  ];

  /* 多词词条：先从词库列表里筛出牛津里真有词条、且有中文释义的 */
  const multiwordCandidates = [];
  if (sources.entry.size) {
    const listed = JSON.parse(readFileSync(resolve(OUTPUT_DIR, "multiword.json"), "utf8")).words;
    for (const phrase of listed) {
      const own = sources.entry.get(phrase.toLowerCase());
      if (!own) continue;
      const cn = own.senses.filter((sense) => !sense.idiom && sense.translation).map((sense) => sense.translation).join("；");
      if (cn.trim()) multiwordCandidates.push({ phrase, cn: cn.trim(), entry: own.word });
    }
  }
  books[2].pool = new Map(multiwordCandidates.map((item) => [item.phrase.toLowerCase(), { cn: item.cn }]));

  const collocListed = JSON.parse(readFileSync(resolve(OUTPUT_DIR, "colloc.json"), "utf8")).words;

  /* 1) 判分 */
  if (!writeOnly) {
    const jobs = [];
    for (const phrase of collocListed) {
      const key = phrase.toLowerCase();
      const source = sources.collocation.get(key);
      if (source?.cn && !judgments.has(key)) jobs.push({ phrase, prompt: COLLOC_PROMPT, book: "colloc" });
    }
    for (const item of multiwordCandidates) {
      const key = item.phrase.toLowerCase();
      if (!judgments.has(key)) jobs.push({ phrase: item.phrase, prompt: MULTIWORD_PROMPT, book: "multiword" });
    }
    console.log(`待判分 ${jobs.length} 条（已有 ${judgments.size} 条进度）`);
    await runPool(
      limit ? jobs.slice(0, limit) : jobs,
      async (job) => {
        const value = await askModel(`${job.prompt}\n\n词条：${job.phrase}`, 40);
        const keep = value.keep === true || value.keep === "true";
        judgments.set(job.phrase.toLowerCase(), { phrase: job.phrase, keep, book: job.book });
        appendLog(JUDGMENT_LOG, { phrase: job.phrase.toLowerCase(), keep, book: job.book });
      },
      (done, total) => {
        if (done % 200 === 0 || done === total) console.log(`  判分 ${done}/${total}`);
      },
    );
  }

  /* 2) 组装三本书 */
  /* 习语以现有词库清单为准（全留），只要牛津能给中文释义 */
  const idiomListed = JSON.parse(readFileSync(resolve(OUTPUT_DIR, "idiom.json"), "utf8")).words;
  const idiomWords = idiomListed.filter((phrase) => sources.idiom.get(phrase.toLowerCase())?.cn);
  const collocWords = collocListed.filter((phrase) => {
    const key = phrase.toLowerCase();
    return sources.collocation.get(key)?.cn && judgments.get(key)?.keep === true;
  });
  const multiwordWords = multiwordCandidates
    .filter((item) => judgments.get(item.phrase.toLowerCase())?.keep === true)
    .map((item) => item.phrase);

  const plan = [
    { id: "idiom", name: "固定习语", words: idiomWords },
    { id: "colloc", name: "常见搭配", words: collocWords },
    { id: "multiword", name: "多词词条", words: multiwordWords },
  ];
  console.log(`清洗后：固定习语 ${idiomWords.length} / 常见搭配 ${collocWords.length} / 多词词条 ${multiwordWords.length}`);

  /* 3) 例句：先用牛津自带的，其余交给本地模型 */
  const needExample = [];
  for (const book of plan) {
    for (const phrase of book.words) {
      const key = phrase.toLowerCase();
      if (examples.has(key)) continue;
      const own = ownExample(sources, phrase);
      if (own) {
        examples.set(key, { phrase, ...own });
        appendLog(EXAMPLE_LOG, { phrase: key, ...own });
        continue;
      }
      needExample.push({ phrase, book: book.id });
    }
  }
  console.log(`需要生成例句 ${needExample.length} 条（已有 ${examples.size} 条进度）`);

  if (!writeOnly && needExample.length) {
    const started = Date.now();
    await runPool(
      limit ? needExample.slice(0, limit) : needExample,
      async (item) => {
        const meaning = sources.collocation.get(item.phrase.toLowerCase())?.cn
          ?? sources.idiom.get(item.phrase.toLowerCase())?.cn
          ?? "";
        const english = await askModel(`${EXAMPLE_PROMPT}\n\n短语：${item.phrase}\n中文释义：${meaning || "（暂无）"}`, 200);
        const text = String(english.en ?? "").trim();
        if (!text) return;
        const chinese = await askModel(`${TRANSLATE_PROMPT}\n\n英文：${text}`, 160);
        const translation = String(chinese.cn ?? "").trim();
        const record = {
          phrase: item.phrase.toLowerCase(),
          en: text,
          cn: /[A-Za-z]/.test(translation) ? "" : translation,
          source: "ai",
        };
        examples.set(record.phrase, { ...record, phrase: item.phrase });
        appendLog(EXAMPLE_LOG, record);
      },
      (done, total) => {
        if (done % 100 === 0 || done === total) {
          const minutes = ((Date.now() - started) / 60000).toFixed(1);
          console.log(`  例句 ${done}/${total}（已用 ${minutes} 分钟）`);
        }
      },
    );
  }

  /* 4) 写回词库文件：保留 words 数组，另外挂 meanings / examples 两个映射 */
  const summary = [];
  for (const book of plan) {
    const meanings = {};
    const exampleMap = {};
    for (const phrase of book.words) {
      const key = phrase.toLowerCase();
      const { cn, en } = meaningOf(sources, phrase);
      if (cn || en) meanings[phrase] = { ...(cn ? { cn } : {}), ...(en ? { en } : {}) };
      const example = examples.get(key);
      if (example?.en) exampleMap[phrase] = { en: example.en, ...(example.cn ? { cn: example.cn } : {}), source: example.source ?? "ai" };
    }
    if (dryRun) {
      summary.push(`${book.name} ${book.words.length} 条（有释义 ${Object.keys(meanings).length}，有例句 ${Object.keys(exampleMap).length}）—— 试跑，没有写文件`);
      continue;
    }
    const payload = {
      id: book.id,
      name: book.name,
      count: book.words.length,
      words: book.words,
      meanings,
      examples: exampleMap,
    };
    writeFileSync(resolve(OUTPUT_DIR, `${book.id}.json`), `${JSON.stringify(payload)}\n`, "utf8");
    summary.push(`${book.name} ${book.words.length} 条（有释义 ${Object.keys(meanings).length}，有例句 ${Object.keys(exampleMap).length}）`);
  }
  console.log("已写回：");
  for (const line of summary) console.log(`  ${line}`);
}

main().catch((error) => {
  console.error("失败：", error.message);
  process.exit(1);
});

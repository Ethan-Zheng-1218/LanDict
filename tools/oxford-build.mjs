/**
 * 牛津高阶双解 .mdx 词条 HTML 的解析。仅在构建期使用。
 *
 * 只负责释义、例句、搭配、变形指向与中文索引，**不解析音标**——
 * 音标链路仍由 server/oxford.ts 的 queryOxfordPronunciation 负责，本文件不碰它。
 *
 * 词条结构（实测 cat）：
 *   <font color=darkred font=+1><b><i>noun </i></b></font>   ← 词性
 *    1. a small animal with soft fur.<br>                     ← 英英释义
 *   <font color=#FF5000>• 猫</font>:<br>                     ← 义项中文翻译
 *   <SPAN style="color:#04F">»cat food </SPAN><br>           ← 搭配或例句
 *   <font style="color:#039;…">猫食品 </font>                ← 搭配/例句的中文
 */

import { JSDOM } from "jsdom";

const PARTS_OF_SPEECH = new Set([
  "noun", "verb", "adjective", "adverb", "preposition", "pronoun", "conjunction",
  "determiner", "exclamation", "number", "adj.", "adv.", "abbr.", "int.", "aux. v.", "modal v.",
]);

/** 中英混用的括号里是语域、地区或量词限定语，不是可独立命中的中文词。 */
const PARENTHETICAL = /[（(][^）)]*[）)]/g;

const INFLECTION_MARKER = /\b(?:pt|pp|pl|pres part|past part|comparative|superlative)\b[^a-z]{0,4}\bof\b/i;
const CROSS_REFERENCE_MARKER = /--›\s*see\b/;
const ENTRY_LINK = /<a href="entry:\/\/([^"]+)">/i;

/**
 * 词条里穿插的导航文本：交叉引用、成语区标题、成语条目符号。
 * 它们不是释义，出现时必须把释义缓冲清空，否则第二个义项之后的释义会变成
 * `--› see also kitten , tomcat 2. a wild animal of the cat family` 这种串行结果。
 */
const CROSS_REFERENCE = /--›/;
/**
 * 词条里还有 【VN】【SYNONYMS】【HELP】 等语法与用法标记，它们不是成语区。
 * 只有 【IDIOMS】 之后的义项才是成语，否则 abandon 的正常义项会被整片误标。
 */
const IDIOM_SECTION = /【\s*IDIOMS\s*】/i;
const IDIOM_ENTRY = /◘/;

/** 牛津在词头前加 ♠ 标记核心词，它不是拼写的一部分。 */
const HEADWORD_SYMBOL = /^[♠●◆■♦★☆\s]+/;

function stripTags(value) {
  return value.replace(/<[^>]*>/g, " ");
}

/** 词条里的颜色既可能写在 color 属性上，也可能写在 style 里，统一成小写无空格的字符串。 */
function colorOf(element) {
  return `${element.getAttribute("color") ?? ""} ${element.getAttribute("style") ?? ""}`
    .replace(/\s/g, "")
    .toLowerCase();
}

function cleanText(value) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/^[\s•·◙»]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingColon(value) {
  return value.replace(/^[:：,，;；\s]+/, "");
}

/**
 * 义项 = 词性 + 英英释义 + 中文翻译。
 *
 * 必须在 DOM 上逐节点遍历，不能先做标记再切字符串：搭配与例句是 SPAN 子树，
 * 字符串做法会把它们当成释义的一部分（实测会让第二个义项的释义变成
 * `: »cat food 猫食品 2. a wild animal…`）。同理，遇到词性标记要清空缓冲，
 * 否则词头与音标会漏进第一个义项的释义。
 */
function parseSenses(fragment) {
  const senses = [];
  let pos = "";
  let buffer = "";
  let inIdioms = false;
  /** 交叉引用那一行整行都不是释义，遇到 <br> 才恢复。 */
  let skipping = false;

  for (const node of fragment.childNodes) {
    const isText = node.nodeType === 3;
    const isElement = node.nodeType === 1;
    if (!isText && !isElement) continue;
    const ownText = node.textContent ?? "";
    const color = isElement ? colorOf(node) : "";

    // 成语区标题在跳过导航的同时也必须生效，所以先判它。
    if (IDIOM_SECTION.test(ownText)) { inIdioms = true; skipping = false; buffer = ""; continue; }
    if (IDIOM_ENTRY.test(ownText)) buffer = "";
    if (isElement && node.tagName === "BR") { skipping = false; buffer += " "; continue; }

    if (isElement && node.tagName === "FONT" && color.includes("darkred")) {
      const italic = cleanText(node.querySelector("i")?.textContent ?? "");
      if (PARTS_OF_SPEECH.has(italic.toLowerCase())) {
        pos = italic.toLowerCase();
        buffer = "";
        skipping = false;
        // 【IDIOMS】 在每个词性区段的末尾，换词性就说明成语区已经结束。
        inIdioms = false;
      }
      continue;
    }
    if (isElement && node.tagName === "FONT" && color.includes("#ff5000")) {
      const translation = cleanText(node.textContent ?? "");
      if (translation) {
        senses.push({
          pos,
          definition: stripLeadingColon(cleanText(buffer)),
          translation,
          ...(inIdioms ? { idiom: true } : {}),
        });
      }
      buffer = "";
      skipping = false;
      continue;
    }
    // 搭配与例句的整棵子树都不算释义。
    if (isElement && (color.includes("#04f") || color.includes("#039"))) { skipping = false; continue; }

    if (CROSS_REFERENCE.test(ownText)) { skipping = true; buffer = ""; continue; }
    if (skipping) continue;
    buffer += ownText;
  }
  return senses;
}

/** 中文翻译可能紧跟在跨过若干 <br> 的 #039 字体里，与 server/oxford.ts 的判定保持一致。 */
function siblingTranslation(element) {
  let sibling = element.nextElementSibling;
  while (sibling?.tagName === "BR") sibling = sibling.nextElementSibling;
  if (!sibling || sibling.tagName !== "FONT") return undefined;
  const style = (sibling.getAttribute("style") ?? "").replace(/\s/g, "").toLowerCase();
  return style.includes("color:#039") ? cleanText(sibling.textContent ?? "") : undefined;
}

function isSentence(value) {
  return /[.!?][”"']?$/.test(value) || value.split(/\s+/).length >= 6;
}

/**
 * #04F 的 span 是搭配或例句：短语进搭配，句子进例句。
 * 同一个词性只留第一条例句，避免长词条把例句列表撑爆。
 */
function parseUsage(fragment, word) {
  const collocations = [];
  const collocationTranslations = {};
  const examples = [];
  let currentPos = "";

  for (const element of fragment.querySelectorAll("i, span")) {
    const text = cleanText(element.textContent ?? "");
    if (element.tagName === "I" && PARTS_OF_SPEECH.has(text.toLowerCase())) {
      const color = element.closest("font")?.getAttribute("color")?.toLowerCase();
      if (color === "darkred") currentPos = text.toLowerCase();
      continue;
    }
    if (!currentPos || element.tagName !== "SPAN") continue;
    const style = (element.getAttribute("style") ?? "").replace(/\s/g, "").toLowerCase();

    if (style.includes("color:#04f")) {
      const translation = siblingTranslation(element);
      if (isSentence(text)) {
        if (!examples.some((example) => example.pos === currentPos)) {
          examples.push({ pos: currentPos, text, ...(translation ? { translation } : {}) });
        }
      } else {
        const collocation = text.replace(/^~\s*/, `${word} `);
        if (collocation && !collocations.includes(collocation)) {
          collocations.push(collocation);
          if (translation) collocationTranslations[collocation] = translation;
        }
      }
    }

    if (style.includes("text-decoration:underline")) {
      const collocation = text.replace(/^~\s*/, `${word} `);
      if (collocation && !collocations.includes(collocation)) collocations.push(collocation);
    }
  }
  return { collocations: collocations.slice(0, 8), collocationTranslations, examples };
}

function findLemmaBase(html, plain) {
  const isInflection = INFLECTION_MARKER.test(plain);
  const isShortCrossReference = CROSS_REFERENCE_MARKER.test(plain) && plain.length <= 60;
  if (!isInflection && !isShortCrossReference) return undefined;
  return html.match(ENTRY_LINK)?.[1];
}

export function parseOxfordEntry(html, word) {
  const source = html.replace(/\0/g, "");
  const fragment = JSDOM.fragment(source);
  const plain = cleanText(fragment.textContent ?? "");
  const senses = parseSenses(fragment);
  const usage = parseUsage(fragment, word);
  const headword = cleanText(fragment.querySelector("b")?.textContent ?? "").replace(HEADWORD_SYMBOL, "") || word;
  const lemmaBase = findLemmaBase(source, plain);

  return {
    word,
    headword,
    pos: senses[0]?.pos ?? "",
    senses,
    collocations: usage.collocations,
    collocationTranslations: usage.collocationTranslations,
    examples: usage.examples,
    ...(lemmaBase ? { lemmaBase } : {}),
  };
}

/**
 * 中文反查索引。括号限定语必须先整体丢弃再切分，否则 `(猫、鼠等的)须`
 * 会让 whisker 命中「猫」——这正是设计文档记录的反查噪音来源。
 *
 * 另外只收前几个义项、且排除成语区。牛津的义项按常用度排序，越往后越是专门的用法，
 * 词往往只是在那里被提到一次：`equal` 的第 5 个义项里带过「无敌」，收录它就等于
 * 让查「无敌」的人看到 equal。get / give / back 那些上百义项的词同理。
 */
const MAX_INDEXED_SENSE = 2;

export function extractHanziIndex(entries) {
  const items = [];
  for (const entry of entries) {
    entry.senses.forEach((sense, senseIndex) => {
      if (sense.idiom || senseIndex > MAX_INDEXED_SENSE) return;
      for (const piece of sense.translation.replace(PARENTHETICAL, " ").split(/[，,；;、:：]/)) {
        const term = (piece.match(/[\u4e00-\u9fff]+/g) ?? []).join("");
        if (!term || term.length > 6) continue;
        items.push({ term, word: entry.word, senseIndex });
      }
    });
  }
  return items;
}

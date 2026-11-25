/**
 * CC-CEDICT 原始文本的解析与中文反查索引构建。
 *
 * 原始文件是 CRLF 换行的纯文本（下载地址虽然带 ?c=gzip，实际返回的是未压缩文本），
 * 每行形如：
 *   貓 猫 [mao1] /cat (CL:隻|只[zhi1])/(dialect) to hide oneself/(loanword) (coll.) modem/
 * 以 # 开头的是注释与元数据行，必须跳过。
 */

const LINE_PATTERN = /^(\S+)\s+(\S+)\s+\[([^\]]*)\]\s+\/(.*)\/$/;

/** 只保留查词时真正能用的英文单词或短语，最长三个词。 */
const TERM_PATTERN = /^[a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2}$/;

/** 圆括号里是语域、地区标记或量词信息（(coll.)、(dialect)、(CL:…)），都不是可用的英文对应词。 */
const PARENTHETICAL = /\([^)]*\)/g;

/** 把一条 gloss 拆成英文对应词。`to ` 必须逐段剥离，不能只剥整串开头。 */
function englishTerms(gloss) {
  return gloss
    .replace(PARENTHETICAL, " ")
    .split(/[;,]/)
    .map((term) => term.trim().replace(/^to\s+/i, "").trim().toLowerCase())
    .filter((term) => TERM_PATTERN.test(term));
}

export function parseCedictEntries(text) {
  const entries = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(LINE_PATTERN);
    if (!match) continue;
    entries.push({
      traditional: match[1],
      simplified: match[2],
      pinyin: match[3],
      glosses: match[4].split("/").map((gloss) => gloss.trim()).filter(Boolean),
    });
  }
  return entries;
}

export function toReverseIndex(entries) {
  const index = new Map();
  for (const entry of entries) {
    const terms = [];
    for (const gloss of entry.glosses) terms.push(...englishTerms(gloss));
    if (!terms.length) continue;
    const existing = index.get(entry.simplified) ?? [];
    for (const term of terms) if (!existing.includes(term)) existing.push(term);
    index.set(entry.simplified, existing);
  }
  return index;
}

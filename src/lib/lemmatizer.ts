/**
 * 词形还原。把变形词还原成候选原形，供查词与阅读页高亮使用。
 *
 * 这里只负责「猜」候选，不负责任判断。候选是否成立由调用方拿去词典验证：
 * 查词路径会先试原词，原词有条目就不会走到候选；阅读页高亮只对已在生词本里的词做匹配。
 * 这样即使规则猜错（worker -> work），也不会污染一个本来能查到的词。
 */

const VOWELS = "aeiou";

function endsWithDoubledConsonant(stem: string) {
  if (stem.length < 2) return false;
  const last = stem[stem.length - 1];
  return last === stem[stem.length - 2] && !VOWELS.includes(last);
}

/**
 * 规则变形词的候选原形：复数、过去式、过去分词、现在分词。
 *
 * 刻意不含 -er/-est 比较级：`-er` 去掉会把 worker 变成 work、computer 变成 compute，
 * 那是两个不同的词。比较级只在 IRREGULAR_FORMS 里按需列出。
 */
export function baseFormCandidates(word: string): string[] {
  const lower = word.toLowerCase();
  const candidates = new Set<string>();
  const push = (candidate: string) => {
    if (candidate.length >= 3 && candidate !== lower) candidates.add(candidate);
  };

  if (lower.endsWith("ies")) push(`${lower.slice(0, -3)}y`);
  if (lower.endsWith("es")) {
    push(lower.slice(0, -2));
    push(lower.slice(0, -1));
  }
  if (lower.endsWith("s") && !lower.endsWith("ss")) push(lower.slice(0, -1));

  if (lower.endsWith("ied")) push(`${lower.slice(0, -3)}y`);
  if (lower.endsWith("ed")) {
    const stem = lower.slice(0, -2);
    push(stem);
    push(`${stem}e`);
    if (endsWithDoubledConsonant(stem)) push(stem.slice(0, -1));
  }

  if (lower.endsWith("ing")) {
    const stem = lower.slice(0, -3);
    push(stem);
    push(`${stem}e`);
    if (endsWithDoubledConsonant(stem)) push(stem.slice(0, -1));
  }

  return [...candidates];
}

/**
 * 派生素的候选原形。这些规则比变形规则更容易猜错（`carefully` -> `careful` 对，
 * 但 `manner` -> `man` 就错），所以只放在候选列表的末尾，靠词典验证兜底。
 */
function derivedBaseCandidates(lower: string): string[] {
  const candidates = new Set<string>();
  const push = (candidate: string) => {
    if (candidate.length >= 3 && candidate !== lower) candidates.add(candidate);
  };
  const pushStem = (stem: string) => {
    push(stem);
    push(`${stem}e`);
    if (stem.endsWith("i")) push(`${stem.slice(0, -1)}y`);
    if (endsWithDoubledConsonant(stem)) push(stem.slice(0, -1));
  };

  if (lower.endsWith("ly")) pushStem(lower.slice(0, -2));
  if (lower.endsWith("ness")) pushStem(lower.slice(0, -4));
  if (lower.endsWith("ment")) pushStem(lower.slice(0, -4));
  if (lower.endsWith("ation")) { pushStem(lower.slice(0, -5)); push(`${lower.slice(0, -5)}ate`); }
  if (lower.endsWith("able")) pushStem(lower.slice(0, -4));

  return [...candidates];
}

/**
 * 常见不规则变形。只列规则推不出来的：元音交替（ran/run）、完全换词（went/go）、
 * 不规则复数（children/child）与不规则比较级（better/good）。
 */
export const IRREGULAR_FORMS: Readonly<Record<string, string>> = {
  am: "be", is: "be", are: "be", was: "be", were: "be", been: "be", being: "be",
  has: "have", had: "have", having: "have",
  does: "do", did: "do", done: "do", doing: "do",
  went: "go", gone: "go", goes: "go",
  ran: "run", runs: "run",
  ate: "eat", eaten: "eat",
  took: "take", taken: "take",
  made: "make", saw: "see", seen: "see",
  said: "say", gave: "give", given: "give",
  got: "get", gotten: "get",
  came: "come", found: "find",
  thought: "think", bought: "buy", brought: "bring",
  taught: "teach", caught: "catch",
  wrote: "write", written: "write",
  spoke: "speak", spoken: "speak",
  broke: "break", broken: "break",
  froze: "freeze", frozen: "freeze",
  chose: "choose", chosen: "choose",
  drove: "drive", driven: "drive",
  flew: "fly", flown: "fly",
  grew: "grow", grown: "grow",
  knew: "know", known: "know",
  threw: "throw", thrown: "throw",
  wore: "wear", worn: "wear",
  won: "win", lost: "lose",
  left: "leave", felt: "feel", kept: "keep",
  slept: "sleep", meant: "mean", met: "meet",
  paid: "pay", sold: "sell", told: "tell",
  stood: "stand", understood: "understand",
  children: "child", men: "man", women: "woman",
  feet: "foot", teeth: "tooth", mice: "mouse",
  geese: "goose", people: "person",
  knives: "knife", leaves: "leaf", lives: "life",
  wives: "wife", wolves: "wolf", shelves: "shelf",
  halves: "half", loaves: "loaf", thieves: "thief",
  better: "good", best: "good",
  worse: "bad", worst: "bad",
  further: "far", furthest: "far", farther: "far", farthest: "far",
  more: "much", most: "much",
};

/**
 * 一个词的完整候选原形：不规则映射优先，其次规则变形，最后派生规则。
 * 结果不含原词本身，调用方先把原词发出去再发这些。
 */
export function lemmaCandidates(word: string): string[] {
  const lower = word.toLowerCase();
  const irregular = IRREGULAR_FORMS[lower];
  const ordered = [
    ...(irregular ? [irregular] : []),
    ...baseFormCandidates(lower),
    ...derivedBaseCandidates(lower),
  ];
  // 长度下限只用于拦住规则猜出来的短词（不能把 used 剥成 us）；
  // 不规则表里的原形是人工确认过的，go 这种两字母原形必须留下。
  return [...new Set(ordered)]
    .filter((candidate) => candidate !== lower)
    .filter((candidate) => candidate === irregular || candidate.length >= 3);
}

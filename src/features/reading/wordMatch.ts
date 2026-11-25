/**
 * The reading view colours a word when the vocabulary already holds it. Matching has to survive
 * inflection, because a notebook holding `run` must light up `ran`, `running` and `runs` in the
 * article — and a notebook holding `governments` must light up `government`.
 *
 * Two layers do that:
 *  - `wordFamilyStore` supplies the irregular forms no rule can guess: ran/run, went/go,
 *    children/child, better/good. It used to read ECDICT's exchange column through the dev-only
 *    `/api/word-family` endpoint, which the installed app could never reach; it now builds the same
 *    families from the local irregular table plus Oxford's lemma table.
 *  - the local candidate rules below cover regular endings. They are deliberately crude, but they
 *    keep highlighting useful when the lookup API is unreachable, and they only ever match
 *    against words already saved in the notebook.
 */

/** Every form family the reading view knows about, keyed by the lowercased notebook word. */
import { baseFormCandidates } from "../../lib/lemmatizer";

export type WordFamilyMap = Record<string, string[]>;

export type WordMatcher = (word: string) => boolean;

// 规则原形候选已抽到 src/lib/lemmatizer.ts，与查词路径共用同一份实现。
// 这里保留同名导出，原有的调用点与测试无需改动。
export { baseFormCandidates };

/**
 * Builds the predicate the article renderer uses per word. The notebook word itself, its regular
 * base forms and every ECDICT family form all count as known, so matching works in both directions
 * regardless of which form the notebook happens to hold.
 */
export function buildWordMatcher(vocabularyWords: Iterable<string>, families: WordFamilyMap): WordMatcher {
  const known = new Set<string>();
  for (const raw of vocabularyWords) {
    const lower = raw.toLowerCase();
    known.add(lower);
    for (const candidate of baseFormCandidates(lower)) known.add(candidate);
    for (const form of families[lower] ?? []) known.add(form.toLowerCase());
  }
  return (word: string) => {
    const lower = word.toLowerCase();
    return known.has(lower) || baseFormCandidates(lower).some((candidate) => known.has(candidate));
  };
}

type IdentifiedEntry = { word: string };

/**
 * Finds the notebook entry an article word belongs to. Clicking `ran` in the article has to open the
 * panel for the saved `run`, otherwise a family match would highlight a word that then looks unsaved.
 */
export function findVocabularyEntry<T extends IdentifiedEntry>(
  entries: T[],
  word: string,
  families: WordFamilyMap,
): T | undefined {
  const lower = word.toLowerCase();
  const exact = entries.find((entry) => entry.word.toLowerCase() === lower);
  if (exact) return exact;

  const candidates = new Set([lower, ...baseFormCandidates(lower)]);
  return entries.find((entry) => {
    const entryLower = entry.word.toLowerCase();
    if (candidates.has(entryLower)) return true;
    return (families[entryLower] ?? []).some((form) => form.toLowerCase() === lower);
  });
}

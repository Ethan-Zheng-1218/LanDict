import { resolveWordQuery, type DictionaryAtomicApi } from "./dictionaryResolver";
import type { WordQueryResult } from "./translationService";
import { spellingVariants } from "./wordSuggestions";

export async function correctSpelling(result: WordQueryResult, api: DictionaryAtomicApi, signal?: AbortSignal): Promise<WordQueryResult> {
  if (result.status !== "empty" || !api.lookupSuggestions) return result;
  const variants = spellingVariants(result.query);
  if (!variants.length) return result;
  try {
    const allowed = new Set(variants);
    const candidates = [...new Set(await api.lookupSuggestions("", variants, signal))].filter(word => allowed.has(word));
    signal?.throwIfAborted();
    if (candidates.length > 1) return { ...result, spellingSuggestions: candidates.slice(0, 5) };
    if (candidates.length === 1) {
      const corrected = await resolveWordQuery(candidates[0], api, signal);
      if (corrected.status === "success") return { ...corrected, query: result.query, correctedWord: candidates[0] };
    }
  } catch { signal?.throwIfAborted(); }
  return result;
}

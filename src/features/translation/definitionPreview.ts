import { createDictionaryApi } from "./dictionaryProvider";
import type { DictionaryAtomicApi } from "./dictionaryResolver";
import { adaptEcdictRecord } from "./ecdictAdapter";

const POS: Record<string, string> = {
  noun: "n.", n: "n.", verb: "v.", v: "v.", vt: "v.", vi: "v.",
  adjective: "adj.", adj: "adj.", adverb: "adv.", adv: "adv.",
  pronoun: "pron.", pron: "pron.", preposition: "prep.", prep: "prep.",
  conjunction: "conj.", conj: "conj.", interjection: "int.", int: "int.",
  determiner: "det.", det: "det.", auxiliary: "v.", exclamation: "int.",
};

/** Preview never resolves inflections, requests pronunciation, or invokes online/AI providers. */
export async function getDefinitionPreview(
  input: string,
  api: Pick<DictionaryAtomicApi, "lookupWords"> = createDictionaryApi(),
  signal?: AbortSignal,
): Promise<string> {
  const word = input.trim();
  if (word.length > 80 || !/^[a-z]+(?:[-'][a-z]+)*$/i.test(word)) return "";
  const hits = await api.lookupWords([word], signal);
  const hit = hits[word.toLowerCase()];
  if (!hit) return "";
  const oxford = hit.oxford?.senses.filter(sense => !sense.idiom && sense.translation).map(sense => ({
    partOfSpeech: sense.pos, translations: [sense.translation],
  }));
  const meanings = oxford?.length ? oxford : hit.ecdict ? adaptEcdictRecord(hit.ecdict).meanings : [];
  const groups = new Map<string, string>();
  for (const item of meanings) {
    const pos = POS[item.partOfSpeech.toLowerCase().replace(/\./g, "").trim()] ?? "";
    if (groups.has(pos)) continue;
    const short = item.translations.map(value => value.replace(/（[^）]*）|\([^)]*\)|\[[^\]]*\]/g, "").split(/[；;，,、。]/)[0].trim()).find(Boolean);
    if (!short) continue;
    groups.set(pos, `${pos ? `${pos} ` : ""}${short.length > 12 ? `${short.slice(0, 12)}…` : short}`);
    if (groups.size === 2) break;
  }
  return [...groups.values()].join("；");
}

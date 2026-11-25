import { createDictionaryApi } from "./dictionaryProvider";
import type { DictionaryAtomicApi } from "./dictionaryResolver";

export async function getInputCompletion(value: string, signal?: AbortSignal, api: Pick<DictionaryAtomicApi, "lookupSuggestions"> = createDictionaryApi()): Promise<string> {
  if (!/^[a-z]{2,32}$/i.test(value) || !api.lookupSuggestions) return "";
  const prefix = value.toLowerCase();
  const words = await api.lookupSuggestions(prefix, [], signal);
  const word = words.find(word => /^[a-z]+$/.test(word) && word.startsWith(prefix) && word.length > value.length);
  if (!word) return "";
  return value + (value === value.toUpperCase() ? word.slice(value.length).toUpperCase() : word.slice(value.length));
}

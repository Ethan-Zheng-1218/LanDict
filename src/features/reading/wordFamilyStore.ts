/**
 * 阅读页的词族来源。
 *
 * 旧实现请求 `/api/word-family`，那个接口只有开发服务器才有，桌面版必然失败，
 * 于是安装版的阅读页实际只有规则层在生效。现在改为：
 *
 * 1. 本地规则：`lemmaCandidates` 给出候选原形，不规则表反过来给出已知的变形词；
 * 2. 牛津的变形指向表：通过原子查询的 `lookupLemmas` 补充本地表没有的形式。
 *
 * 两者都是「有则更好」：原子查询拿不到时只用本地规则，高亮照常工作。
 */

import { useEffect, useState } from "react";
import { readStored, writeStored } from "../../lib/browserStorage";
import { IRREGULAR_FORMS, lemmaCandidates } from "../../lib/lemmatizer";
import { createDictionaryApi } from "../translation/dictionaryProvider";
import type { WordFamilyMap } from "./wordMatch";

export const WORD_FAMILY_STORAGE_KEY = "landict.reading.word-families.v1";

/** Guards a pathological notebook from turning into a multi-kilobyte query string. */
const MAX_WORDS_PER_REQUEST = 400;

function isWordFamilyMap(value: unknown): value is WordFamilyMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(([word, forms]) =>
    word.length > 0 && Array.isArray(forms) && forms.every((form) => typeof form === "string"),
  );
}

/**
 * 已知以某个词为原形的变形词。不规则表只有一百来条，直接反向建表，
 * 不必为「run 有哪些变形」再发一次请求。
 */
const FORMS_BY_LEMMA = Object.entries(IRREGULAR_FORMS).reduce((map, [form, lemma]) => {
  const forms = map.get(lemma) ?? [];
  forms.push(form);
  map.set(lemma, forms);
  return map;
}, new Map<string, string[]>());

/** 一个笔记本词能点亮哪些文章词。 */
export function wordFamily(word: string, lemma?: string): string[] {
  const lower = word.toLowerCase();
  const forms = new Set<string>([lower, ...lemmaCandidates(lower)]);
  for (const base of [lower, lemma?.toLowerCase()]) {
    if (!base) continue;
    forms.add(base);
    for (const form of FORMS_BY_LEMMA.get(base) ?? []) forms.add(form);
  }
  return [...forms];
}

let cache: WordFamilyMap | undefined;

function getCache(): WordFamilyMap {
  cache ??= readStored(WORD_FAMILY_STORAGE_KEY, {}, isWordFamilyMap);
  return cache;
}

function collectMissingWords(words: string[], known: WordFamilyMap): string[] {
  const missing: string[] = [];
  for (const word of words) {
    const lower = word.trim().toLowerCase();
    if (!lower || lower in known || missing.includes(lower)) continue;
    missing.push(lower);
  }
  return missing;
}

/**
 * 读取这些词的词族。永不抛错：原子查询不可用时退回纯本地规则。
 * 词族一旦算出来就写进缓存，同一个词不会重复查。
 */
export async function loadWordFamilies(words: string[]): Promise<WordFamilyMap> {
  const known = getCache();
  const missing = collectMissingWords(words, known).slice(0, MAX_WORDS_PER_REQUEST);
  if (!missing.length) return known;

  let lemmas: Record<string, string> = {};
  try {
    lemmas = await createDictionaryApi().lookupLemmas(missing);
  } catch {
    lemmas = {};
  }

  for (const word of missing) known[word] = wordFamily(word, lemmas[word]);
  cache = known;
  writeStored(WORD_FAMILY_STORAGE_KEY, known);
  return known;
}

/**
 * Families for a notebook, keyed by the lowercased word list. Pass the vocabulary words joined with
 * `\u0000` so the effect only re-runs when the set of saved words actually changes.
 */
export function useWordFamilies(vocabularyKey: string): WordFamilyMap {
  const [families, setFamilies] = useState<WordFamilyMap>(() => getCache());

  useEffect(() => {
    if (!vocabularyKey) return;
    let active = true;
    void loadWordFamilies(vocabularyKey.split("\u0000")).then((next) => {
      if (active) setFamilies({ ...next });
    });
    return () => {
      active = false;
    };
  }, [vocabularyKey]);

  return families;
}

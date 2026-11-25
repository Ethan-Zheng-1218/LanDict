import type { EcdictRecord } from "../../../server/ecdict";
import type { DictionaryEntry, DictionaryMeaning, DictionaryWordForm } from "./translationService";
import { selectPrimaryPronunciation } from "../../lib/phonetics";
import { cleanMeaningParts, dedupeMeaningText } from "../../lib/meaningText";

const POS_LABELS: Record<string, string> = {
  n: "noun", v: "verb", j: "adjective", r: "adverb", i: "preposition", c: "conjunction",
  p: "pronoun", m: "numeral", u: "interjection", d: "determiner", a: "article", t: "particle",
};

const TRANSLATION_POS: Record<string, string> = {
  n: "noun", v: "verb", vi: "verb", vt: "verb", a: "adjective", adj: "adjective",
  ad: "adjective", adv: "adverb", r: "adverb", prep: "preposition", conj: "conjunction",
  pron: "pronoun", num: "numeral", art: "article", aux: "auxiliary verb", int: "interjection",
};

const FORM_LABELS: Record<string, string> = {
  s: "复数", f: "复数", p: "过去式", d: "过去分词", i: "现在分词", "3": "第三人称单数",
  r: "比较级", b: "比较级", t: "最高级", z: "最高级",
};

function formatPhonetic(value: string | null) {
  return selectPrimaryPronunciation(value) || "—";
}

function parsePos(value: string | null) {
  if (!value?.trim()) return [];
  return [...new Set(value.split("/").map((item) => {
    const [code] = item.split(":");
    return POS_LABELS[code?.trim() ?? ""];
  }).filter((item): item is string => Boolean(item)))];
}

function canonicalText(value: string) {
  return value.normalize("NFKC").replace(DOMAIN_SENSE, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function dedupeText(values: string[], removeContained = false) {
  const unique = new Map<string, string>();
  for (const value of values) {
    const text = value.trim();
    if (text && !unique.has(canonicalText(text))) unique.set(canonicalText(text), text);
  }
  const items = [...unique.values()];
  if (!removeContained) return items;
  return items.filter((item) => {
    const key = canonicalText(item);
    return !items.some((other) => {
      const otherKey = canonicalText(other);
      return other !== item && otherKey.length > key.length && otherKey.includes(key);
    });
  });
}

function parseTranslationMarker(value: string) {
  const match = value.match(/^\s*([a-z]+(?:\s*[.])?)\s+(.+)$/i);
  if (!match) return { partOfSpeech: "", value: value.trim() };
  const code = match[1].replace(/\./g, "").toLowerCase();
  return { partOfSpeech: TRANSLATION_POS[code] ?? (code === "pl" ? "noun" : ""), value: match[2].trim() };
}

/** ECDICT marks specialised senses with a domain prefix such as [医] or [计]. */
const DOMAIN_SENSE = /^[\[［【(]\s*[^\]］】)]{1,8}\s*[\]］】)]/u;

function isDomainSense(value: string) {
  return DOMAIN_SENSE.test(value.trim());
}

function parseTranslations(value: string | null, fallbackPos: string[]) {
  const lines = (value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const allowedPos = new Set(fallbackPos);
  const collect = (dropDomainSenses: boolean) => {
    const meanings: DictionaryMeaning[] = [];
    const discoveredPos: string[] = [];
    for (const line of lines) {
      // "[医] 表现, 表示" is one specialised sense list, so the whole line goes away.
      if (dropDomainSenses && isDomainSense(line)) continue;
      const parsed = parseTranslationMarker(line);
      if (parsed.partOfSpeech && allowedPos.size > 0 && !allowedPos.has(parsed.partOfSpeech)) continue;
      const partOfSpeech = parsed.partOfSpeech || fallbackPos[0] || "";
      if (partOfSpeech && !discoveredPos.includes(partOfSpeech)) discoveredPos.push(partOfSpeech);
      const translation = parsed.value
        .split(/[;,，；]/)
        .map((item) => item.trim())
        .filter((item) => item && (!dropDomainSenses || !isDomainSense(item)));
      const cleanedTranslation = cleanMeaningParts(translation, { dropDomainSenses });
      if (!cleanedTranslation.length) continue;
      const existing = meanings.find((item) => item.partOfSpeech === partOfSpeech);
      if (existing) {
        existing.translations = cleanMeaningParts([...existing.translations, ...cleanedTranslation], { dropDomainSenses });
      } else {
        meanings.push({ partOfSpeech, translations: cleanedTranslation });
      }
    }
    const seen = new Set<string>();
    for (const meaning of meanings) {
      meaning.translations = meaning.translations.filter((item) => {
        const key = item.normalize("NFKC").replace(DOMAIN_SENSE, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    return { meanings: meanings.filter((meaning) => meaning.translations.length), discoveredPos };
  };
  // Specialised senses ("[医] 表现") are noise for general reading, but a word that only has
  // them must still show something rather than an empty definition.
  const general = collect(true);
  return general.meanings.length ? general : collect(false);
}

function parseDefinitions(value: string | null) {
  const lines = (value ?? "").split(/\r?\n/).map((line) => {
    const parsed = parseTranslationMarker(line);
    return parsed.partOfSpeech ? parsed.value : line.trim();
  }).filter(Boolean);
  return dedupeText(lines);
}

function parseWordForms(value: string | null, word: string) {
  if (!value?.trim()) return [];
  const entries = new Map<string, DictionaryWordForm>();
  let relatedWord = "";
  let relationCode = "";
  for (const item of value.split("/")) {
    const separator = item.indexOf(":");
    if (separator < 0) continue;
    const code = item.slice(0, separator).trim();
    const form = item.slice(separator + 1).trim();
    if (code === "0") { relatedWord = form; continue; }
    if (code === "1") { relationCode = form; continue; }
    const label = FORM_LABELS[code];
    if (!label || !form || (form === word && code !== "s" && code !== "f")) continue;
    if (relatedWord && form === `${relatedWord}s` && form !== word) continue;
    const key = `${label}:${form}`;
    entries.set(key, { label, value: form });
  }
  if (relationCode && relatedWord) {
    const label = FORM_LABELS[relationCode];
    if (label) entries.set(`${label}:${word}`, { label, value: word, relatedWord });
  }
  const relationLabel = relationCode ? FORM_LABELS[relationCode] : undefined;
  return [...entries.values()].filter((form) => !relationLabel || form.label !== relationLabel || form.value === word || Boolean(form.relatedWord));
}

export function adaptEcdictRecord(record: EcdictRecord): DictionaryEntry {
  const pos = parsePos(record.pos);
  const parsedTranslations = parseTranslations(record.translation, pos);
  const meanings = parsedTranslations.meanings;
  const flattenedMeaning = meanings.flatMap((meaning) => meaning.translations).join("\n");
  const allPos = [...new Set([...pos, ...parsedTranslations.discoveredPos, ...meanings.map((meaning) => meaning.partOfSpeech).filter(Boolean)])];
  const definitions = parseDefinitions(record.definition);
  const wordForms = parseWordForms(record.exchange, record.word);
  return {
    word: record.word,
    phonetic: formatPhonetic(record.phonetic),
    britishPhonetic: formatPhonetic(record.phonetic),
    americanPhonetic: formatPhonetic(record.phonetic),
    partOfSpeech: allPos.join(" · "),
    meanings,
    definitions,
    example: "",
    collocations: [],
    collocationTranslations: {},
    examples: [],
    wordForms,
    meaning: dedupeMeaningText(flattenedMeaning) || flattenedMeaning,
    definition: definitions.join("\n"),
    exchange: wordForms.map((form) => `${form.label} ${form.value}`),
    source: "ECDICT",
  };
}

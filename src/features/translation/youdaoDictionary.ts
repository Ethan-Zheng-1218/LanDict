import { invokeWithAbort } from "../../lib/desktop";
import { usesDesktopBackend } from "./dictionaryProvider";
import type { DictionaryEntry, DictionaryMeaning, WordQueryResult } from "./translationService";

// jsonapi is Youdao's public website endpoint, not its paid developer API.
// Keep parsing shared between Vite and Tauri; malformed/unavailable data falls back locally.
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const itemText = (value: unknown): string => text(object(object(value).l).i);

/** Bounded dictionary terms only; URLs, punctuation and full paragraphs stay local. */
export function isSupportedYoudaoQuery(query: string) {
  return query.length <= 80 && (/^[a-zA-Z]+(?:[-'][a-zA-Z]+)*(?: +[a-zA-Z]+(?:[-'][a-zA-Z]+)*){0,5}$/.test(query)
    || /^[\p{Script=Han}]{1,12}$/u.test(query));
}

function parseChineseDictionary(query: string, payload: unknown): WordQueryResult | undefined {
  const word = object(list(object(object(payload).ce).word)[0]);
  const headword = itemText(word["return-phrase"]);
  if (headword !== query) return undefined;
  const entries: DictionaryEntry[] = list(word.trs).flatMap(sense => list(object(sense).tr)).flatMap(value => {
    const line = object(object(value).l);
    // CE expressions mix literal spaces with linked tokens; joining with spaces
    // would split words or add spaces that were not present in the source.
    const expression = list(line.i).map(part => typeof part === "string" ? part : text(object(part)["#text"])).join("").trim();
    if (!/[a-z]/i.test(expression)) return [];
    const meaning = text(line["#tran"]) || query;
    const partOfSpeech = text(line.pos);
    return [{
      word: expression, source: "Youdao", phonetic: "", britishPhonetic: "", americanPhonetic: "",
      partOfSpeech, meanings: [{ partOfSpeech, translations: [meaning] }], meaning,
      definitions: [], definition: "", exchange: [], example: "", examples: [], collocations: [], wordForms: [],
    }];
  });
  if (!entries.length) return undefined;
  const meaning = entries.map(entry => `${entry.word}　${entry.meaning}`).join("\n");
  return {
    kind: "word", query, status: "success", source: "有道词典", entries,
    britishPhonetic: "—", americanPhonetic: "—", meaning, example: "",
    panels: [{ id: "ecdict", label: "词库解释", badge: "", title: "有道词典", body: meaning }],
  };
}

export function parseYoudaoDictionary(query: string, payload: unknown): WordQueryResult | undefined {
  if (/^\p{Script=Han}+$/u.test(query)) return parseChineseDictionary(query, payload);
  const data = object(payload);
  const word = object(list(object(data.ec).word)[0]);
  const headword = itemText(word["return-phrase"]);
  // Do not turn spelling suggestions for another word into a successful lookup.
  if (!headword || headword.toLowerCase().replace(/ +/g, " ") !== query.toLowerCase().replace(/ +/g, " ")) return undefined;
  const groups = new Map<string, string[]>();
  for (const sense of list(word.trs)) {
    for (const translation of list(object(sense).tr)) {
      for (const value of list(object(object(translation).l).i)) {
        const line = text(value);
        if (!line) continue;
        const match = line.match(/^([a-z]+\.)\s*(.*)$/i);
        const pos = match?.[1] ?? "";
        const meaning = match?.[2] ?? line;
        if (!meaning) continue;
        const existing = groups.get(pos) ?? [];
        if (!existing.includes(meaning)) existing.push(meaning);
        groups.set(pos, existing);
      }
    }
  }
  const meanings: DictionaryMeaning[] = [...groups].map(([partOfSpeech, translations]) => ({ partOfSpeech, translations }));
  if (!meanings.length) return undefined;
  const meaning = meanings.flatMap(item => item.translations).join("\n");
  const examples = list(object(data.blng_sents_part)["sentence-pair"]).slice(0, 3).flatMap(value => {
    const item = object(value);
    const sentence = text(item.sentence);
    return sentence ? [{ partOfSpeech: "", text: sentence, ...(text(item["sentence-translation"]) ? { translation: text(item["sentence-translation"]) } : {}) }] : [];
  });
  const collocationTranslations: Record<string, string> = {};
  const collocations: string[] = [];
  for (const value of list(object(data.phrs).phrs).slice(0, 8)) {
    const phrase = object(object(value).phr);
    const title = itemText(phrase.headword);
    if (!title || collocations.includes(title)) continue;
    collocations.push(title);
    collocationTranslations[title] = list(phrase.trs).map(tr => itemText(object(tr).tr)).filter(Boolean).join("；");
  }
  const ipa = (value: unknown) => { const raw = text(value).replace(/^\/+|\/+$/g, ""); return raw ? `/${raw}/` : ""; };
  const britishPhonetic = ipa(word.ukphone || word.phone);
  const americanPhonetic = ipa(word.usphone || word.phone);
  return {
    kind: "word", query, status: "success", britishPhonetic: britishPhonetic || "—", americanPhonetic: americanPhonetic || "—",
    source: "有道词典", meaning, example: examples[0]?.text ?? "",
    panels: [{ id: "ecdict", label: "词库解释", badge: "", title: "有道词典", body: meaning }],
    entries: [{
      word: headword, source: "Youdao", phonetic: britishPhonetic, britishPhonetic, americanPhonetic,
      partOfSpeech: [...groups.keys()].filter(Boolean).join(" · "), meanings, meaning,
      definitions: [], definition: "", exchange: [], example: examples[0]?.text ?? "", examples,
      collocations, collocationTranslations,
      wordForms: list(word.wfs).flatMap(value => {
        const form = object(object(value).wf);
        return text(form.name) && text(form.value) ? [{ label: text(form.name), value: text(form.value) }] : [];
      }),
    }],
  };
}

export async function lookupYoudaoDictionary(word: string, signal?: AbortSignal): Promise<WordQueryResult | undefined> {
  signal?.throwIfAborted();
  if (!isSupportedYoudaoQuery(word)) return undefined;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return undefined;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 4000);
  try {
    let payload: unknown;
    if (usesDesktopBackend()) {
      payload = await invokeWithAbort("youdao_dictionary", { word }, controller.signal);
    } else {
      const response = await fetch(`/api/youdao-dictionary?word=${encodeURIComponent(word)}`, { signal: controller.signal });
      if (!response.ok) return undefined;
      payload = await response.json();
    }
    signal?.throwIfAborted();
    return parseYoudaoDictionary(word, payload);
  } catch {
    signal?.throwIfAborted();
    return undefined;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

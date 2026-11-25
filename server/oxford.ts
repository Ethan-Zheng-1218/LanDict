import { createRequire } from "node:module";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";

type MdxLookupResult = { keyText: string; definition?: string };
type MdxDictionary = { lookup(word: string): MdxLookupResult };
type MdxConstructor = new (path: string) => MdxDictionary;

export type OxfordExample = { partOfSpeech: string; text: string; translation?: string };
export type OxfordUsage = { collocations: string[]; collocationTranslations?: Record<string, string>; examples: OxfordExample[] };
export type OxfordPronunciation = { britishIpa: string; americanIpa: string };

const require = createRequire(import.meta.url);
const { Mdx } = require("@runer-hq/mdict") as { Mdx: MdxConstructor };
const OXFORD_DICTIONARY_PATH = resolve(
  process.cwd(),
  "data/牛津高阶双解 Oxford Advanced Learner's English-Chinese Dictionary 7th.mdx",
);
const PARTS_OF_SPEECH = new Set([
  "noun", "verb", "adjective", "adverb", "preposition", "pronoun", "conjunction", "determiner", "exclamation", "number",
]);

let dictionary: MdxDictionary | undefined;

// Oxford's bundled MDX stores pronunciation text in the legacy Kingsoft
// Phonetic font. Convert its ASCII code points to portable Unicode IPA before
// returning anything to the UI or persistence layer.
const KINGSOFT_PHONETIC_TO_IPA: Record<string, string> = {
  "5": "ˈ",
  "9": "ˌ",
  A: "æ",
  B: "ɑ",
  C: "ɔ",
  F: "ʃ",
  J: "ŋ",
  N: "ŋ",
  Q: "ʌ",
  T: "ð",
  V: "ʒ",
  W: "θ",
  "^": "ɡ",
  i: "ɪ",
  u: "ʊ",
  ":": "ː",
};

const KINGSOFT_LITERAL_CHARACTERS = new Set("abcdefghjklmnopqrstuvwxyz.() -");

function cleanText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/^\s*»\s*/, "").replace(/\s+/g, " ").trim();
}

function decodeOxfordIpa(encoded: string) {
  const characters = [...encoded.trim()];
  if (!characters.length) return "";
  let decoded = "";
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (character === "E") {
      decoded += characters[index + 1] === ":" ? "ɜ" : "ə";
    } else if (character === "i") {
      decoded += characters[index + 1] === ":" ? "i" : "ɪ";
    } else if (character === "u") {
      decoded += characters[index + 1] === ":" ? "u" : "ʊ";
    } else if (KINGSOFT_PHONETIC_TO_IPA[character]) {
      decoded += KINGSOFT_PHONETIC_TO_IPA[character];
    } else if (KINGSOFT_LITERAL_CHARACTERS.has(character)) {
      decoded += character;
    } else {
      return "";
    }
  }
  return `/${decoded}/`;
}

function parseOxfordPronunciation(html: string): OxfordPronunciation {
  const headwordHtml = html.replace(/\0/g, "").split(/<br\s*\/?\s*>/i, 1)[0];
  const fragment = JSDOM.fragment(headwordHtml);
  const encodedValues = [...fragment.querySelectorAll("font[face*='Kingsoft Phonetic']")]
    .map((element) => cleanText(element.textContent ?? ""))
    .filter(Boolean);
  const britishIpa = decodeOxfordIpa(encodedValues[0] ?? "");
  const americanIpa = decodeOxfordIpa(encodedValues[1] ?? "") || britishIpa;
  return { britishIpa, americanIpa };
}

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.normalize("NFKC").toLocaleLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isSentence(value: string) {
  return /[.!?][”"']?$/.test(value) || value.split(/\s+/).length >= 6;
}

function findSiblingTranslation(element: Element) {
  let sibling = element.nextElementSibling;
  while (sibling?.tagName === "BR") sibling = sibling.nextElementSibling;
  if (!sibling || sibling.tagName !== "FONT") return undefined;
  const style = (sibling.getAttribute("style") ?? "").replace(/\s/g, "").toLocaleLowerCase();
  return style.includes("color:#039") ? cleanText(sibling.textContent ?? "") : undefined;
}

function parseOxfordUsage(word: string, html: string): OxfordUsage {
  const fragment = JSDOM.fragment(html.replace(/\0/g, ""));
  const collocations: string[] = [];
  const collocationTranslations: Record<string, string> = {};
  const examples = new Map<string, OxfordExample>();
  let currentPartOfSpeech = "";

  fragment.querySelectorAll("i, span").forEach((element) => {
    const text = cleanText(element.textContent ?? "");
    if (element.tagName === "I" && PARTS_OF_SPEECH.has(text.toLocaleLowerCase())) {
      const color = element.closest("font")?.getAttribute("color")?.toLocaleLowerCase();
      if (color === "darkred") currentPartOfSpeech = text.toLocaleLowerCase();
      return;
    }
    if (!currentPartOfSpeech || element.tagName !== "SPAN") return;

    const style = (element.getAttribute("style") ?? "").replace(/\s/g, "").toLocaleLowerCase();
    if (style.includes("color:#04f")) {
      const translation = findSiblingTranslation(element);
      if (isSentence(text)) {
        if (!examples.has(currentPartOfSpeech)) examples.set(currentPartOfSpeech, { partOfSpeech: currentPartOfSpeech, text, ...(translation ? { translation } : {}) });
      } else {
        const collocation = text.replace(/^~\s*/, `${word} `);
        collocations.push(collocation);
        if (translation) collocationTranslations[collocation] = translation;
      }
    }
    if (style.includes("text-decoration:underline")) {
      collocations.push(text.replace(/^~\s*/, `${word} `));
    }
  });

  const uniqueCollocations = unique(collocations).slice(0, 8);
  return {
    collocations: uniqueCollocations,
    collocationTranslations: Object.fromEntries(uniqueCollocations.filter((item) => collocationTranslations[item]).map((item) => [item, collocationTranslations[item]])),
    examples: [...examples.values()],
  };
}

export function queryOxfordUsage(word: string): OxfordUsage {
  const normalized = word.trim();
  if (!/^[a-zA-Z]+(?:[-'][a-zA-Z]+)*$/.test(normalized)) return { collocations: [], examples: [] };
  try {
    dictionary ??= new Mdx(OXFORD_DICTIONARY_PATH);
    let result = dictionary.lookup(normalized);
    if (result.definition?.startsWith("@@@LINK=")) result = dictionary.lookup(result.definition.slice(8).trim());
    return result.definition ? parseOxfordUsage(normalized, result.definition) : { collocations: [], examples: [] };
  } catch {
    return { collocations: [], examples: [] };
  }
}

export function queryOxfordPronunciation(word: string): OxfordPronunciation {
  const normalized = word.trim();
  if (!/^[a-zA-Z]+(?:[-'][a-zA-Z]+)*$/.test(normalized)) return { britishIpa: "", americanIpa: "" };
  try {
    dictionary ??= new Mdx(OXFORD_DICTIONARY_PATH);
    let result = dictionary.lookup(normalized);
    if (result.definition?.startsWith("@@@LINK=")) result = dictionary.lookup(result.definition.slice(8).trim());
    return result.definition ? parseOxfordPronunciation(result.definition) : { britishIpa: "", americanIpa: "" };
  } catch {
    return { britishIpa: "", americanIpa: "" };
  }
}

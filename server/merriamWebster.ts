import { createRequire } from "node:module";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { selectPrimaryPronunciation } from "../src/lib/phonetics";

type MdxLookupResult = { keyText: string; definition?: string };
type MdxDictionary = { lookup(word: string): MdxLookupResult };
type MdxConstructor = new (path: string) => MdxDictionary;

export type MerriamWebsterPronunciation = {
  /** Merriam-Webster's original respelling, not IPA. */
  pronunciation: string;
  audioId: string;
  audioUrl?: string;
};

const require = createRequire(import.meta.url);
const { Mdx } = require("@runer-hq/mdict") as { Mdx: MdxConstructor };
const MERRIAM_WEBSTER_DICTIONARY_PATH = resolve(
  process.cwd(),
  "data/Merriam-Webster's Collegiate Dictionary, 2015.mdx",
);

let dictionary: MdxDictionary | undefined;

function cleanText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function americanRespelling(value: string) {
  return selectPrimaryPronunciation(cleanText(value));
}

function getAudioDirectory(audioId: string) {
  const normalized = audioId.toLocaleLowerCase();
  if (normalized.startsWith("bix")) return "bix";
  if (normalized.startsWith("gg")) return "gg";
  if (/^\d/.test(normalized)) return "number";
  return normalized.slice(0, 1);
}

export function getMerriamWebsterAudioUrl(audioId: string) {
  const normalized = audioId.trim();
  const directory = getAudioDirectory(normalized);
  if (!normalized || !directory) return "";
  return `https://media.merriam-webster.com/audio/prons/en/us/mp3/${directory}/${encodeURIComponent(normalized)}.mp3`;
}

function emptyResult(): MerriamWebsterPronunciation {
  return { pronunciation: "", audioId: "" };
}

export function queryMerriamWebsterPronunciation(word: string): MerriamWebsterPronunciation {
  const normalized = word.trim();
  if (!/^[a-zA-Z]+(?:[-'][a-zA-Z]+)*$/.test(normalized)) return emptyResult();

  try {
    dictionary ??= new Mdx(MERRIAM_WEBSTER_DICTIONARY_PATH);
    let result = dictionary.lookup(normalized);
    if (result.definition?.startsWith("@@@LINK=")) result = dictionary.lookup(result.definition.slice(8).trim());
    const definition = result.definition;
    if (!definition) return emptyResult();

    const pronunciation = americanRespelling(JSDOM.fragment(definition.replace(/\0/g, "")).querySelector(".byp")?.textContent ?? "");
    const audioId = definition.match(/dzp\.v\(this,\s*['\"]([^'\"]+)['\"]\)/)?.[1] ?? "";
    const audioUrl = getMerriamWebsterAudioUrl(audioId);
    return { pronunciation, audioId, ...(audioUrl ? { audioUrl } : {}) };
  } catch {
    return emptyResult();
  }
}

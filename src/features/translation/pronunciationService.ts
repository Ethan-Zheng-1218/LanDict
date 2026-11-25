import { selectPrimaryPronunciation } from "../../lib/phonetics";
import { invokeWithAbort } from "../../lib/desktop";
import { createDesktopDictionaryApi, usesDesktopBackend } from "./dictionaryProvider";

export type PronunciationAudio = { gb?: string; us?: string; gbText?: string; usText?: string };
export type IpaPronunciation = { gbText?: string; usText?: string };
export type PronunciationIpaSource = "oxford" | "youdao" | "fallback";
export type PronunciationAudioSource = "merriam-webster" | "youdao" | "dictionary-api" | "system-tts";
export type AccentPronunciation = { ipa: string; audioUrl?: string; ipaSource: PronunciationIpaSource; audioSource: PronunciationAudioSource };
export type WordPronunciation = { british: AccentPronunciation; american: AccentPronunciation };
export type LocalWordPronunciation = { britishPhonetic: string; americanPhonetic: string; ecdictPhonetic?: string; americanAudioUrl?: string };

/**
 * 有道公开的发音接口：把单词拼进 URL 就有真人录音，不需要 key、也不用抓网页。
 * 官方把两种口音写在 `ukspeech` / `usspeech` 字段里：英式 `type=1`，美式 `type=2`。
 * 这是"英式真人录音"目前唯一覆盖够好的免费来源（牛津官网的 mp3 路径带编号，得先抓词条页）。
 */
export function youdaoAudioUrl(word: string, accent: "uk" | "us"): string {
  const query = encodeURIComponent(word.trim().toLowerCase());
  return `https://dict.youdao.com/dictvoice?audio=${query}&type=${accent === "uk" ? 1 : 2}`;
}

/**
 * 有道的美式音标。只在牛津只给出"与英式不同的那半截"（`government` 的 `/-vərn-/`）
 * 或干脆没有美式音标时才去问一次——抽样里这类词只占 3%~6%。
 * 浏览器直连会被有道挡住（403 且没有 CORS 头），所以开发版走 dev server 的
 * `/api/youdao-ipa`，桌面版走 Rust 的 `youdao_ipa` 命令。
 */
const youdaoIpaCache = new Map<string, string>();

export async function fetchYoudaoIpa(word: string, signal?: AbortSignal): Promise<string> {
  const key = word.trim().toLowerCase();
  if (!key) return "";
  const cached = youdaoIpaCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const usphone = usesDesktopBackend()
      ? (await invokeWithAbort<{ usphone?: string }>("youdao_ipa", { word: key }, signal))?.usphone ?? ""
      : await fetchBrowserYoudaoIpa(key, signal);
    /* 有道不带斜杠，这里补上，和牛津/维基那两份音标保持同一种写法。 */
    const trimmed = usphone.trim().replace(/^\/+|\/+$/g, "");
    const value = trimmed ? `/${trimmed}/` : "";
    /* 只记成功的结果：暂时取不到（网络抖动）时下次还要再试。 */
    if (value) youdaoIpaCache.set(key, value);
    return value;
  } catch {
    return "";
  }
}

async function fetchBrowserYoudaoIpa(word: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`/api/youdao-ipa?word=${encodeURIComponent(word)}`, signal ? { signal } : undefined);
  if (!response.ok) return "";
  const data = (await response.json()) as { usphone?: unknown };
  return typeof data.usphone === "string" ? data.usphone : "";
}

type DictionaryApiPhonetic = { audio?: unknown; text?: unknown };
type DictionaryApiEntry = { phonetics?: unknown };

const DICTIONARY_API_URL = "https://api.dictionaryapi.dev/api/v2/entries/en/";

function audioAccent(audio: string): "gb" | "us" | undefined {
  const path = audio.toLowerCase();
  if (/(?:^|[-_/.])(uk|gb)(?:[-_.\/]\d*)?(?:\.mp3)?$/.test(path) || /[-_](uk|gb)(?:[-_.\/]|$)/.test(path)) return "gb";
  if (/(?:^|[-_/.])us(?:[-_.\/]|$)/.test(path)) return "us";
  return undefined;
}

function isAudioUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function fetchOnlinePronunciations(word: string, signal?: AbortSignal): Promise<PronunciationAudio> {
  try {
    const response = await fetch(`${DICTIONARY_API_URL}${encodeURIComponent(word.trim())}`, { signal });
    if (!response.ok) return {};
    const data = await response.json() as DictionaryApiEntry[];
    const result: PronunciationAudio = {};
    for (const entry of Array.isArray(data) ? data : []) {
      const phonetics = Array.isArray(entry.phonetics) ? entry.phonetics : [];
      for (const phonetic of phonetics as DictionaryApiPhonetic[]) {
        if (!isAudioUrl(phonetic.audio)) continue;
        const accent = audioAccent(phonetic.audio);
        if (accent && !result[accent]) result[accent] = phonetic.audio;
        if (accent && typeof phonetic.text === "string" && phonetic.text.trim() && !result[`${accent}Text`]) result[`${accent}Text`] = phonetic.text.trim();
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function parseWiktionaryPronunciation(wikitext: string): IpaPronunciation {
  const section = wikitext.match(/===Pronunciation===([\s\S]*?)(?=\n===|$)/i)?.[1] ?? "";
  const result: IpaPronunciation = {};
  const pattern = /\{\{IPA\|en\|([^}]+)\}\}/gi;
  for (const match of section.matchAll(pattern)) {
    const fields = match[1].split("|");
    const accents = fields.find((field) => field.startsWith("a="))
      ?.slice(2)
      .split(",")
      .map((value) => value.trim().toUpperCase()) ?? [];
    const ipa = fields.find((field) => /^\/.+\/$/.test(field.trim()))?.trim();
    if (!ipa || accents.length === 0) continue;
    if (accents.some((accent) => ["RP", "UK", "GB", "BRITISH", "BRE"].includes(accent)) && !result.gbText) {
      result.gbText = ipa;
    }
    if (accents.some((accent) => ["US", "GA", "GENAM", "GENERAL AMERICAN", "AME"].includes(accent)) && !result.usText) {
      result.usText = ipa;
    }
  }
  return result;
}

export async function fetchIpaPronunciations(word: string, signal?: AbortSignal): Promise<IpaPronunciation> {
  try {
    const encodedWord = encodeURIComponent(word.trim());
    // The installed app has no Vite middleware to relay the Wiktionary request.
    const url = usesDesktopBackend()
      ? `https://en.wiktionary.org/w/api.php?action=parse&page=${encodedWord}&prop=wikitext&format=json&origin=*`
      : `/api/ipa-pronunciation?word=${encodedWord}`;
    const response = await fetch(url, { signal });
    if (!response.ok) return {};
    const data = await response.json() as {
      wikitext?: unknown;
      parse?: { wikitext?: { "*"?: unknown } };
    };
    const wikitext = typeof data.wikitext === "string"
      ? data.wikitext
      : data.parse?.wikitext?.["*"];
    return typeof wikitext === "string" ? parseWiktionaryPronunciation(wikitext) : {};
  } catch {
    return {};
  }
}

export async function fetchLocalWordPronunciation(word: string, signal?: AbortSignal): Promise<LocalWordPronunciation> {
  try {
    if (usesDesktopBackend()) {
      const hint = await createDesktopDictionaryApi().lookupPronunciation(word.trim(), signal);
      const ecdictPhonetic = selectPrimaryPronunciation(hint.ecdictPhonetic);
      return {
        britishPhonetic: "",
        americanPhonetic: "",
        ...(ecdictPhonetic ? { ecdictPhonetic } : {}),
      };
    }
    const response = await fetch(`/api/local-dictionary?word=${encodeURIComponent(word.trim())}`, { signal });
    if (!response.ok) return { britishPhonetic: "", americanPhonetic: "" };
    const data = await response.json() as {
      oxfordPronunciation?: { britishIpa?: unknown; americanIpa?: unknown };
      merriamWebster?: { pronunciation?: unknown; audioUrl?: unknown };
      britishPhonetic?: unknown;
    };
    const ecdictPhonetic = typeof data.britishPhonetic === "string" ? data.britishPhonetic.trim() : "";
    return {
      britishPhonetic: typeof data.oxfordPronunciation?.britishIpa === "string" ? data.oxfordPronunciation.britishIpa : "",
      americanPhonetic: typeof data.oxfordPronunciation?.americanIpa === "string" ? data.oxfordPronunciation.americanIpa : "",
      ...(ecdictPhonetic ? { ecdictPhonetic } : {}),
      ...(typeof data.merriamWebster?.audioUrl === "string" ? { americanAudioUrl: data.merriamWebster.audioUrl } : {}),
    };
  } catch {
    return { britishPhonetic: "", americanPhonetic: "" };
  }
}

function isFragmentIpa(ipa: string) { return /^\/-/.test(ipa.trim()); }

function combineWordPronunciation(
  local: LocalWordPronunciation,
  online: PronunciationAudio,
  fallback: IpaPronunciation,
  youdao: PronunciationAudio,
  youdaoAmericanIpa: string,
): WordPronunciation {
  // Oxford first, then Wiktionary / dictionaryapi, and finally the local ECDICT phonetic so a word
  // never falls back to an empty "英 —" slot when the online sources are unreachable.
  const rawBritish = local.britishPhonetic || fallback.gbText || online.gbText || local.ecdictPhonetic || "";
  /* 美式音标：牛津完整 → 有道（只补半截/空缺）→ 维基等在线来源 → 退回英式那一份，不留 "美 —"。 */
  const oxfordAmerican = local.americanPhonetic && !isFragmentIpa(local.americanPhonetic) ? local.americanPhonetic : "";
  const onlineAmerican = [fallback.usText, online.usText].find((value) => value && !isFragmentIpa(value)) ?? "";
  const britishUsable = Boolean(rawBritish) && !isFragmentIpa(rawBritish);
  const knownAmerican = oxfordAmerican || youdaoAmericanIpa || onlineAmerican;
  const britishIpa = britishUsable ? rawBritish : (knownAmerican || rawBritish);
  const americanIpa = knownAmerican || britishIpa;
  const americanIpaSource: PronunciationIpaSource = oxfordAmerican
    ? "oxford"
    : youdaoAmericanIpa
      ? "youdao"
      : onlineAmerican
        ? "fallback"
        : britishUsable && local.britishPhonetic
          ? "oxford"
          : "fallback";
  /* 英式优先用韦氏之外唯一的"真人录音"来源（有道），美式优先韦氏，其次有道，最后才是免费音频。 */
  const britishAudio = online.gb ?? youdao.gb;
  const americanAudio = local.americanAudioUrl ?? youdao.us ?? online.us;
  return {
    british: {
      ipa: britishIpa,
      ...(britishAudio ? { audioUrl: britishAudio } : {}),
      ipaSource: local.britishPhonetic ? "oxford" : "fallback",
      audioSource: online.gb ? "dictionary-api" : youdao.gb ? "youdao" : "system-tts",
    },
    american: {
      ipa: americanIpa,
      ...(americanAudio ? { audioUrl: americanAudio } : {}),
      ipaSource: americanIpaSource,
      audioSource: local.americanAudioUrl
        ? "merriam-webster"
        : youdao.us
          ? "youdao"
          : online.us
            ? "dictionary-api"
            : "system-tts",
    },
  };
}

/** 发音按钮上的来源说明。 */
export function pronunciationAudioLabel(source: PronunciationAudioSource, accent: "uk" | "us"): string {
  if (source === "merriam-webster") return "韦氏美式发音";
  if (source === "youdao") return accent === "uk" ? "有道英式发音" : "有道美式发音";
  if (source === "dictionary-api") return accent === "uk" ? "免费英式发音" : "免费美式发音";
  return accent === "uk" ? "系统英式发音" : "系统美式发音";
}

export async function fetchWordPronunciation(word: string, signal?: AbortSignal, onFallback?: (pronunciation: WordPronunciation) => void): Promise<WordPronunciation> {
  const youdao: PronunciationAudio = { gb: youdaoAudioUrl(word, "uk"), us: youdaoAudioUrl(word, "us") };
  const onlinePromise = fetchOnlinePronunciations(word, signal);
  const local = await fetchLocalWordPronunciation(word, signal);
  /* 牛津的美式音标是"半截"（`/-vərn-/`）或空的，才去有道要一份完整的。 */
  const needsAmericanIpa = !local.americanPhonetic || isFragmentIpa(local.americanPhonetic);
  const youdaoAmericanIpa = needsAmericanIpa ? await fetchYoudaoIpa(word, signal) : "";
  const localResult = combineWordPronunciation(local, {}, {}, youdao, youdaoAmericanIpa);
  const fallbackPromise = local.britishPhonetic && local.americanPhonetic
    ? Promise.resolve<IpaPronunciation>({})
    : fetchIpaPronunciations(word, signal);
  const fullResult = Promise.all([onlinePromise, fallbackPromise])
    .then(([online, fallback]) => combineWordPronunciation(local, online, fallback, youdao, youdaoAmericanIpa));

  if (onFallback) {
    void fullResult.then((pronunciation) => {
      if (!signal?.aborted) onFallback(pronunciation);
    });
    return localResult;
  }
  return fullResult;
}

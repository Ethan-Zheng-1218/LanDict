/**
 * 词典原子查询的两种实现，与策略层（dictionaryResolver）配对使用。
 *
 * 开发版与网页版走本地中间件的 HTTP 接口，打包后的桌面版走 Tauri 原生命令。
 * 两边只负责「取数据」，判断优先级的是策略层。
 *
 * **音标与音频按平台各走各的原路**，见 lookupPronunciation 的实现注释：
 * 开发版继续用 /api/local-dictionary 的牛津 IPA 与韦氏音频（接口保持不动），
 * 桌面版继续用 desktop_dictionary 的 ECDICT 音标。这条是设计文档第八节的硬边界。
 */

import { isTauri } from "@tauri-apps/api/core";
import type { DictionaryHit, ReverseHit } from "../../../server/dictionaryLookup";
import { invokeWithAbort } from "../../lib/desktop";
import type { DictionaryAtomicApi, PronunciationHint } from "./dictionaryResolver";

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/** 两个具体实现都提供音标，只有测试里的假实现才可能省略它。 */
type DictionaryApiWithPronunciation = DictionaryAtomicApi & {
  lookupPronunciation: NonNullable<DictionaryAtomicApi["lookupPronunciation"]>;
};

/** 打包后的桌面版没有开发服务器，必须走原生命令；开发与网页版走本地中间件。 */
export function usesDesktopBackend(): boolean {
  return isTauri() && !LOOPBACK.test(window.location.hostname);
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T | undefined> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) return undefined;
  return (await response.json()) as T;
}

export function createBrowserDictionaryApi(): DictionaryApiWithPronunciation {
  return {
    async lookupSuggestions(prefix, words, signal) {
      const data = await postJson<{ words?: string[] }>("/api/dictionary-suggest", { prefix, words }, signal);
      return Array.isArray(data?.words) ? data.words.filter(word => typeof word === "string") : [];
    },
    async lookupWords(words, signal) {
      const data = await postJson<{ hits: Record<string, DictionaryHit> }>("/api/dictionary-lookup", { words }, signal);
      return data?.hits ?? {};
    },
    async reverseLookup(term, signal) {
      const data = await postJson<{ hits: ReverseHit[] }>("/api/dictionary-reverse", { term }, signal);
      return data?.hits ?? [];
    },
    async lookupLemmas(words, signal) {
      const data = await postJson<{ lemmas: Record<string, string> }>("/api/dictionary-lemmas", { words }, signal);
      return data?.lemmas ?? {};
    },
    async lookupPronunciation(word, signal) {
      // 第 4 个参数保持原样：开发版的音标与音频来源一行未改。
      const response = await fetch(
        `/api/local-dictionary?word=${encodeURIComponent(word)}`,
        signal ? { signal } : undefined,
      );
      if (!response.ok) return {};
      const data = (await response.json()) as {
        britishPhonetic?: string;
        oxfordPronunciation?: { britishIpa?: string; americanIpa?: string };
        merriamWebster?: { audioUrl?: string };
      };
      return {
        ...(data.oxfordPronunciation?.britishIpa ? { britishIpa: data.oxfordPronunciation.britishIpa } : {}),
        ...(data.oxfordPronunciation?.americanIpa ? { americanIpa: data.oxfordPronunciation.americanIpa } : {}),
        ...(data.merriamWebster?.audioUrl ? { americanAudioUrl: data.merriamWebster.audioUrl } : {}),
        ...(data.britishPhonetic ? { ecdictPhonetic: data.britishPhonetic } : {}),
      } satisfies PronunciationHint;
    },
  };
}

export function createDesktopDictionaryApi(): DictionaryApiWithPronunciation {
  return {
    async lookupSuggestions(prefix, words, signal) {
      const data = await invokeWithAbort<unknown>("dictionary_suggest", { prefix, words }, signal);
      return Array.isArray(data) ? data.filter((word): word is string => typeof word === "string") : [];
    },
    async lookupWords(words, signal) {
      return (await invokeWithAbort<Record<string, DictionaryHit>>("dictionary_lookup", { words }, signal)) ?? {};
    },
    async reverseLookup(term, signal) {
      return (await invokeWithAbort<ReverseHit[]>("dictionary_reverse", { term }, signal)) ?? [];
    },
    async lookupLemmas(words, signal) {
      return (await invokeWithAbort<Record<string, string>>("dictionary_lemmas", { words }, signal)) ?? {};
    },
    async lookupPronunciation(word, signal) {
      // 桌面版的音标来源与改动前一致：仍是 ECDICT 音标。
      const data = await invokeWithAbort<{ entry?: { phonetic?: string | null } }>(
        "desktop_dictionary",
        { word },
        signal,
      );
      const phonetic = data?.entry?.phonetic ?? undefined;
      return phonetic ? { ecdictPhonetic: phonetic } : {};
    },
  };
}

export function createDictionaryApi(): DictionaryAtomicApi {
  return usesDesktopBackend() ? createDesktopDictionaryApi() : createBrowserDictionaryApi();
}

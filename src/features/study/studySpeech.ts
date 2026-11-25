/**
 * 背单词页的发音。整件事只有三条规矩：
 *
 * 1. 卡片资料一到就把音频**预热**好（`preloadPronunciationAudio`），等到要读的时候直接放；
 * 2. 要读的那一刻，音频已经能播就放音频，否则**立刻**用系统语音——绝不为等网络不出声；
 * 3. 手点 UK / US 时先试音频，`AUDIO_START_DEADLINE_MS` 还没起播就改用系统语音。
 *
 * 系统语音的口音和音色跟阅读页同一套（reading/speech 的 getSpeechVoice）。
 */

import { getSpeechVoice } from "@/features/reading/speech";

export type SpeechAccent = "en-GB" | "en-US";

/** 点音频后最多等多久；超时就改用系统语音。 */
export const AUDIO_START_DEADLINE_MS = 900;

/** 一张卡上的两条音频。 */
export type PronunciationAudioUrls = { uk?: string; us?: string };

/** 预加载好的音频。同一个地址只建一个元素，重复调用不会重复下载。 */
const audioCache = new Map<string, HTMLAudioElement>();

/** 当前正在播放的音频。换词、收起释义时都要把它停掉。 */
let activeAudio: HTMLAudioElement | null = null;

function audioAvailable(): boolean {
  return typeof Audio !== "undefined";
}

export function preloadPronunciationAudio(url?: string): void {
  if (!url || !audioAvailable() || audioCache.has(url)) return;
  const audio = new Audio(url);
  audio.preload = "auto";
  audioCache.set(url, audio);
}

export function stopPronunciation(): void {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio = null;
  }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

export function speakWord(word: string, accent: SpeechAccent): void {
  if (!word || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return;
  /* 先按口音挑一个音色（和阅读页一致），挑不到就用引擎默认的。 */
  const voice = getSpeechVoice(accent);
  const utterance = new SpeechSynthesisUtterance(spokenText(word));
  utterance.lang = voice?.lang ?? accent;
  if (voice) utterance.voice = voice;
  utterance.rate = 0.92;
  window.speechSynthesis.speak(utterance);
}

/**
 * 词组库里有很多 `sb` / `sth` 占位符（ability to do sth），
 * 直接念的话系统语音会读成字母，换成 something / somebody 才听得懂。
 */
export function spokenText(word: string): string {
  return word.replace(/\bsb\b/gi, "somebody").replace(/\bsth\b/gi, "something");
}

/**
 * 手点发音（UK / US 按钮、空格）：有音频先放音频，但最多等 AUDIO_START_DEADLINE_MS；
 * 音频卡在网络上时改用系统语音，不让这一次点击变成"没反应"。
 */
export function playPronunciation(word: string, accent: SpeechAccent, audioUrl?: string): void {
  if (!word) return;
  stopPronunciation();
  if (!audioUrl || !audioAvailable()) {
    speakWord(word, accent);
    return;
  }
  preloadPronunciationAudio(audioUrl);
  const audio = audioCache.get(audioUrl);
  if (!audio) {
    speakWord(word, accent);
    return;
  }
  const fallback = () => {
    if (activeAudio !== audio) return;
    activeAudio = null;
    audio.pause();
    speakWord(word, accent);
  };
  const timer = window.setTimeout(fallback, AUDIO_START_DEADLINE_MS);
  audio.addEventListener("playing", () => window.clearTimeout(timer), { once: true });
  activeAudio = audio;
  audio.currentTime = 0;
  void audio.play().catch(() => {
    window.clearTimeout(timer);
    fallback();
  });
}

/**
 * 展开释义时自动读一遍。音频已经能播就放音频（零等待），
 * 否则立刻用系统语音。返回值只用于验证"这一声是从哪来的"。
 */
export function pronounceNow(word: string, accent: SpeechAccent, urls: PronunciationAudioUrls): "audio" | "speech" {
  stopPronunciation();
  const url = accent === "en-US" ? urls.us : urls.uk;
  const audio = url ? audioCache.get(url) : undefined;
  if (!audio || audio.readyState < 2) {
    speakWord(word, accent);
    return "speech";
  }
  activeAudio = audio;
  audio.currentTime = 0;
  void audio.play().catch(() => {
    if (activeAudio !== audio) return;
    activeAudio = null;
    speakWord(word, accent);
  });
  return "audio";
}

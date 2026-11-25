import { getReadingVoiceAccent } from "../settings/settingsStore";

export type SpeechAccent = "en-GB" | "en-US";

let cachedVoices: SpeechSynthesisVoice[] = [];

function refreshVoices() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  cachedVoices = window.speechSynthesis.getVoices?.() ?? [];
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  refreshVoices();
  // Edge / WebView2 publish their neural voices asynchronously, so the list is refreshed on change.
  window.speechSynthesis.addEventListener?.("voiceschanged", refreshVoices);
}

/**
 * Chrome only offers Google's cloud voices plus old local ones; Edge and the Tauri WebView2 shell
 * also expose Microsoft's neural "Online (Natural)" voices, which sound far closer to a human.
 * Neural voices win, then any cloud voice, then whatever local voice matches the accent.
 */
export function pickVoiceFor(available: SpeechSynthesisVoice[], lang: SpeechAccent): SpeechSynthesisVoice | undefined {
  const wanted = lang.toLowerCase();
  const exact = available.filter((voice) => voice.lang.replace("_", "-").toLowerCase().startsWith(wanted));
  const sameLanguage = available.filter((voice) => voice.lang.toLowerCase().startsWith(wanted.slice(0, 2)));
  const pool = exact.length ? exact : sameLanguage;
  if (!pool.length) return undefined;
  const rank = (voice: SpeechSynthesisVoice) => /natural|neural/i.test(voice.name) ? 0 : voice.localService ? 2 : 1;
  return [...pool].sort((left, right) => rank(left) - rank(right))[0];
}

export function getSpeechVoice(lang: SpeechAccent): SpeechSynthesisVoice | undefined {
  if (!cachedVoices.length) refreshVoices();
  return pickVoiceFor(cachedVoices, lang);
}

export function getSpeechAccent(): SpeechAccent {
  return getReadingVoiceAccent();
}

function isWordCharacter(value: string | undefined) {
  return Boolean(value && /[A-Za-z'’-]/.test(value));
}

/** Word the engine is currently reading, used for the per-word highlight. */
export function findWordBounds(text: string, index: number, charLength = 0) {
  if (!text) return null;
  let start = Math.max(0, Math.min(index, text.length - 1));
  let end = Math.max(start + 1, Math.min(index + Math.max(1, charLength), text.length));
  if (!isWordCharacter(text[start]) && !isWordCharacter(text[end - 1])) return null;
  while (start > 0 && isWordCharacter(text[start - 1])) start -= 1;
  while (end < text.length && isWordCharacter(text[end])) end += 1;
  while (end > start && !isWordCharacter(text[end - 1])) end -= 1;
  return end > start ? { start, end } : null;
}

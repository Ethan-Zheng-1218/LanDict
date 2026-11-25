/**
 * Keeps the first, primary pronunciation only.  It deliberately does not
 * transform pronunciation symbols: Merriam-Webster respellings are not IPA.
 */
export function selectPrimaryPronunciation(value: string | null | undefined) {
  const raw = value?.trim().replace(/^\/+|\/+$/g, "");
  if (!raw) return "";
  const primary = raw
    .split(/[;；]/, 1)[0]
    .split(/,\s*(?:Canada|British)\b/i, 1)[0]
    .split(/\s+(?:also|or)\s+/i, 1)[0]
    .split(/\.\s+(?=[/'"ˈˌ])/u, 1)[0]
    .split(/,\s*(?=-)/, 1)[0]
    .replace(/[，,\s]+$/, "")
    .trim();
  return primary ? `/${primary}/` : "";
}

export const BROWSER_STORAGE_VERSION = 1;

type StorageEnvelope<T> = {
  version: number;
  data: T;
};

const isStorageEnvelope = <T>(value: unknown): value is StorageEnvelope<T> => {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<StorageEnvelope<T>>;
  return envelope.version === BROWSER_STORAGE_VERSION && "data" in envelope;
};

export function readStored<T>(key: string, fallback: T, validate?: (value: unknown) => value is T): T {
  try {
    // Keep existing settings, vocabulary and reading records available after the rename.
    const raw = window.localStorage.getItem(key)
      ?? (key.startsWith("landict.") ? window.localStorage.getItem(key.replace(/^landict\./, "pudict.")) : null);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (isStorageEnvelope<T>(parsed) && (!validate || validate(parsed.data))) return parsed.data;
    if (validate?.(parsed)) return parsed;
    return fallback;
  } catch {
    return fallback;
  }
}

export function writeStored<T>(key: string, data: T): void {
  window.localStorage.setItem(key, JSON.stringify({ version: BROWSER_STORAGE_VERSION, data }));
}

export function dispatchStorageEvent(eventName: string): void {
  window.dispatchEvent(new CustomEvent(eventName));
}

import { invoke } from "@tauri-apps/api/core";

import type { VocabularyEntry } from "./vocabularyStore";
import { version as appVersion } from "../../../package.json";

export const MAX_VOCABULARY_FILE_BYTES = 50 * 1024 * 1024;
const BACKUP_FORMAT = "landict-vocabulary";
const BACKUP_VERSION = 1;

type BackupResult = { format: "backup" | "unsupported-backup" | "invalid-backup"; entries: VocabularyEntry[] };

export type VocabularyBackupSave =
  | { status: "saved"; path: string; fileName: string }
  | { status: "downloaded"; fileName: string }
  | { status: "cancelled" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isBackupEntry(value: unknown): value is VocabularyEntry {
  if (!isRecord(value)) return false;
  const stringFields = ["id", "word", "meaning", "phonetic", "britishPhonetic", "americanPhonetic", "definition", "partOfSpeech", "example", "source", "note", "createdAt", "updatedAt"];
  return stringFields.every((key) => typeof value[key] === "string")
    && Boolean((value.word as string).trim())
    && ["lookup", "reading", "import"].includes(value.sourceType as string)
    && ["pending", "learning", "mastered"].includes(value.status as string)
    && (value.restoredFromBackup === undefined || typeof value.restoredFromBackup === "boolean")
    && Number.isFinite(Date.parse(value.createdAt as string)) && Number.isFinite(Date.parse(value.updatedAt as string))
    && Array.isArray(value.collocations) && value.collocations.every((item) => typeof item === "string")
    && (value.collocationTranslations === undefined || (isRecord(value.collocationTranslations) && Object.values(value.collocationTranslations).every((item) => typeof item === "string")))
    && (value.examples === undefined || (Array.isArray(value.examples) && value.examples.every((item) => isRecord(item)
      && typeof item.partOfSpeech === "string" && typeof item.text === "string"
      && (item.translation === undefined || typeof item.translation === "string"))));
}

export function readVocabularyBackup(value: unknown): BackupResult | undefined {
  if (!isRecord(value)) return undefined;
  const looksLikeBackup = value.format === BACKUP_FORMAT
    || ("entries" in value && "schemaVersion" in value && "appVersion" in value && "exportedAt" in value);
  if (!looksLikeBackup) return undefined;
  if (value.format !== BACKUP_FORMAT) return { format: "invalid-backup", entries: [] };
  if (value.schemaVersion !== BACKUP_VERSION) return { format: "unsupported-backup", entries: [] };
  if (typeof value.appVersion !== "string" || typeof value.exportedAt !== "string" || !Number.isFinite(Date.parse(value.exportedAt))
    || !Array.isArray(value.entries) || !value.entries.every(isBackupEntry)) return { format: "invalid-backup", entries: [] };
  return { format: "backup", entries: value.entries };
}

export function serializeVocabularyBackup(entries: VocabularyEntry[], now = new Date()): string {
  if (!entries.every(isBackupEntry)) throw new Error("生词数据不完整，暂时无法生成备份");
  return JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: BACKUP_VERSION, appVersion, exportedAt: now.toISOString(), entries }, null, 2);
}

/** Readable default name for the save dialog, e.g. `LanDict-生词本-2026-11-24.json`. */
export function vocabularyBackupFileName(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `LanDict-生词本-${year}-${month}-${day}.json`;
}

function isDesktopShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function downloadInBrowser(contents: string, fileName: string): void {
  const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    // Give the browser/WebView time to begin reading the download before releasing its URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/**
 * Writes the vocabulary backup to a file the user picks.
 *
 * The desktop build opens the native save dialog; a plain browser falls back to
 * the regular download so the web preview keeps working.
 */
export async function saveVocabularyBackup(entries: VocabularyEntry[], now = new Date()): Promise<VocabularyBackupSave> {
  const contents = serializeVocabularyBackup(entries, now);
  const fileName = vocabularyBackupFileName(now);
  if (new Blob([contents]).size > MAX_VOCABULARY_FILE_BYTES) throw new Error("备份超过 50 MB，暂时无法导出");
  if (isDesktopShell()) {
    const path = await invoke<string | null>("export_vocabulary_backup", { defaultName: fileName, contents });
    return path ? { status: "saved", path, fileName } : { status: "cancelled" };
  }
  downloadInBrowser(contents, fileName);
  return { status: "downloaded", fileName };
}

import { isTauri } from "@tauri-apps/api/core";
import { invokeWithAbort } from "../../lib/desktop";

export type LocalTranslation = { translation: string; source: "en" | "zh"; target: "en" | "zh" };

/** This provider has no credentials or network path, including on failures. */
export async function translateLocally(text: string, signal?: AbortSignal): Promise<LocalTranslation> {
  if (!isTauri()) throw new Error("本地翻译仅在 LanDict 桌面版中可用，请使用桌面应用。");
  const source = /\p{Script=Han}/u.test(text) ? "zh" : "en";
  const target = source === "en" ? "zh" : "en";
  return invokeWithAbort<LocalTranslation>("desktop_local_translate", { text, source, target }, signal);
}

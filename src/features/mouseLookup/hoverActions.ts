import { invoke, isTauri } from "@tauri-apps/api/core";

export async function copyHoverContent(text: string): Promise<void> {
  if (isTauri()) await invoke("copy_mouse_lookup_content", { text });
  else await navigator.clipboard.writeText(text);
}

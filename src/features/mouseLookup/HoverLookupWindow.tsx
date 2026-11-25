import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { loadSettings } from "../settings/settingsStore";
import { HoverLookupCard } from "./HoverLookupCard";
import type { HoverSnapshot } from "./types";

export function HoverLookupWindow() {
  const [snapshot, setSnapshot] = useState<HoverSnapshot>({ revision: 0, sample: null });
  const lastSize = useRef("");
  const sampleId = snapshot.sample?.id;
  const resize = useCallback((width: number, height: number) => {
    if (sampleId === undefined) return;
    const key = `${sampleId}:${width}:${height}`;
    if (lastSize.current === key) return;
    lastSize.current = key;
    void invoke("resize_mouse_lookup", { id: sampleId, width, height }).catch(() => {});
  }, [sampleId]);
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    const update = (value: HoverSnapshot) => {
      if (!disposed) setSnapshot((current) => value.revision >= current.revision ? value : current);
    };
    const theme = () => { document.documentElement.dataset.theme = loadSettings().appearance.theme; };
    document.documentElement.dataset.window = "mouse-lookup";
    theme();
    window.addEventListener("storage", theme);
    void (async () => {
      const off = await listen<HoverSnapshot>("mouse-lookup", (event) => update(event.payload));
      if (disposed) { off(); return; }
      unlisten = off;
      update(await invoke<HoverSnapshot>("mouse_lookup_snapshot"));
      await invoke("mouse_lookup_ready");
    })().catch(() => { /* The native worker exposes initialization errors through the tray. */ });
    return () => { disposed = true; unlisten?.(); window.removeEventListener("storage", theme); };
  }, []);
  return snapshot.sample ? <HoverLookupCard key={snapshot.sample.id} sample={snapshot.sample} onResize={resize}
    onActivate={() => { void invoke("activate_mouse_lookup", { id: snapshot.sample!.id }).catch(() => {}); }}
    onClose={() => { void invoke("dismiss_mouse_lookup", { id: snapshot.sample!.id }).catch(() => {}); }} /> : null;
}

import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { loadSettings, saveSettings, SETTINGS_CHANGED_EVENT } from "../settings/settingsStore";

/** Kept mounted when the main window hides so tray preferences remain persistent. */
export function MouseLookupBridge() {
  const [error, setError] = useState("");
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const listeners: UnlistenFn[] = [];
    const sync = () => {
      void invoke<{ error: string | null }>("configure_mouse_lookup", { settings: loadSettings().mouseLookup })
        .then((status) => { if (!disposed) setError(status.error ?? ""); })
        .catch(() => { if (!disposed) setError("鼠标取词未能启动，请重新打开桌面程序"); });
    };
    window.addEventListener(SETTINGS_CHANGED_EVENT, sync);
    void (async () => {
      for (const register of [
        () => listen<boolean>("mouse-lookup-enabled", (event) => {
          if (!disposed) saveSettings({ mouseLookup: { ...loadSettings().mouseLookup, enabled: event.payload } });
        }),
        () => listen<{ error: string | null }>("mouse-lookup-status", (event) => {
          if (!disposed) setError(event.payload.error ?? "");
        }),
      ]) {
        const off = await register();
        if (disposed) { off(); return; }
        listeners.push(off);
      }
      sync();
    })().catch(() => {
      if (!disposed) setError("无法同步鼠标取词设置");
    });
    return () => { disposed = true; listeners.forEach((off) => off()); window.removeEventListener(SETTINGS_CHANGED_EVENT, sync); };
  }, []);
  return error ? <p role="status" className="mouse-lookup-error">{error}</p> : null;
}

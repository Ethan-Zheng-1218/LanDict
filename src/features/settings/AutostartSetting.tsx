import { isTauri } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** Windows is the source of truth, including choices made by the installer. */
export function AutostartSetting() {
  const desktop = isTauri();
  const [enabled, setEnabled] = useState(false);
  const [known, setKnown] = useState(false);
  const [busy, setBusy] = useState(desktop);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    isEnabled().then((value) => {
      if (active) { setEnabled(value); setKnown(true); }
    }).catch((reason: unknown) => {
      if (active) setError(String(reason));
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [desktop]);

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      setEnabled(await isEnabled());
      setKnown(true);
    } catch (reason) {
      setKnown(false);
      setError(String(reason));
    } finally { setBusy(false); }
  }

  async function change(value: boolean) {
    setBusy(true);
    setError("");
    try {
      if (value) await enable(); else await disable();
      // Read back the system value; do not save a separate localStorage flag.
      setKnown(false);
      const actual = await isEnabled();
      setEnabled(actual);
      setKnown(true);
      if (actual !== value) setError("开机自启状态未能更新，请重试。");
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  return <div className="settings-row">
    <div>
      <strong>开机自启</strong>
      <span>{desktop ? "登录 Windows 时自动启动 LanDict" : "仅 Windows 桌面版可设置"}</span>
      {error && <p className="settings-test-result failed" role="alert">{error}</p>}
      {error && <Button variant="secondary" disabled={busy} onClick={() => void refresh()} type="button">重试</Button>}
    </div>
    <label className="settings-switch">
      <input aria-label="开机自启" type="checkbox" checked={enabled} disabled={!desktop || !known || busy} onChange={(event) => void change(event.target.checked)} />
      <span />
    </label>
  </div>;
}

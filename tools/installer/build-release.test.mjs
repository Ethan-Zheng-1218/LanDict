import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it.skipIf(process.platform !== "win32").each(["mismatch", "duplicate"])("rejects a %s release before compiling or replacing any installer", mode => {
  const root = mkdtempSync(join(tmpdir(), "landict-release-guard-"));
  const put = (path, content) => { const target = join(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content); };
  try {
    put("package.json", JSON.stringify({ version: "0.1.2" }));
    put("src-tauri/tauri.conf.json", JSON.stringify({ version: mode === "mismatch" ? "0.1.1" : "0.1.2" }));
    put("src-tauri/Cargo.toml", '[package]\nname = "landict"\nversion = "0.1.2"\n');
    put("src-tauri/Cargo.lock", '[[package]]\nname = "landict"\nversion = "0.1.2"\n');
    put("tools/installer/build-release.ps1", "");
    copyFileSync(resolve("tools/installer/build-release.ps1"), join(root, "tools/installer/build-release.ps1"));
    if (mode === "duplicate") put("src-tauri/target/release/bundle/nsis/LanDict_0.1.2_x64-setup.exe", "previous installer");
    const result = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "tools/installer/build-release.ps1"), "-SkipAssets", "-SkipAppBuild"], { encoding: "utf8", timeout: 10000 });
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(mode === "mismatch" ? "Release versions differ" : "already has an installer");
    expect(existsSync(join(root, "src-tauri/target/installer-preview"))).toBe(false);
  } finally {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected test fixture path");
    rmSync(root, { recursive: true, force: true });
  }
});

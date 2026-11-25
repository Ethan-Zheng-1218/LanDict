import { afterEach, describe, expect, it, vi } from "vitest";
import { translateLocally } from "./localTranslationProvider";
import { invokeWithAbort } from "../../lib/desktop";
import { isTauri } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn(() => true) }));
vi.mock("../../lib/desktop", () => ({ invokeWithAbort: vi.fn(async () => ({ translation: "逐步淘汰", source: "en", target: "zh" })) }));
afterEach(() => vi.clearAllMocks());

describe("local translation provider", () => {
  it("uses native local inference without an HTTP request or credentials", async () => {
    const network = vi.spyOn(globalThis, "fetch");
    expect(await translateLocally("phase out")).toMatchObject({ translation: "逐步淘汰" });
    expect(invokeWithAbort).toHaveBeenCalledWith("desktop_local_translate", { text: "phase out", source: "en", target: "zh" }, undefined);
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
  });
  it("selects Chinese to English without a remote language detector", async () => {
    await translateLocally("期待与你见面");
    expect(invokeWithAbort).toHaveBeenCalledWith("desktop_local_translate", { text: "期待与你见面", source: "zh", target: "en" }, undefined);
  });
  it("reports desktop-only support instead of falling back to a paid API", async () => {
    vi.mocked(isTauri).mockReturnValueOnce(false);
    await expect(translateLocally("phase out")).rejects.toThrow(/桌面版/);
    expect(invokeWithAbort).not.toHaveBeenCalled();
  });
});

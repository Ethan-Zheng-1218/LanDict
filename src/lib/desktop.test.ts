import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { invokeWithAbort } from "./desktop";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it("rejects a desktop response immediately when its query is cancelled", async () => {
  vi.mocked(invoke).mockReturnValue(new Promise(() => {}));
  const controller = new AbortController();
  const pending = invokeWithAbort("desktop_ai_request", {}, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});

it("does not start a native operation with an already cancelled signal", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(invokeWithAbort("desktop_dictionary", { word: "cat" }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(invoke).not.toHaveBeenCalled();
});

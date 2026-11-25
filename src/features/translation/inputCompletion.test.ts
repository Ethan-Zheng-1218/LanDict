import { expect, it, vi } from "vitest";
import { getInputCompletion } from "./inputCompletion";
it("uses the top local prefix candidate and preserves the user's casing", async () => {
  const lookupSuggestions = vi.fn(async () => ["captain", "capture"]);
  const api = { lookupSuggestions };
  expect(await getInputCompletion("CAPT", undefined, api)).toBe("CAPTAIN");
  expect(await getInputCompletion("Capt", undefined, api)).toBe("Captain");
  expect(await getInputCompletion("capt", undefined, api)).toBe("captain");
  expect(await getInputCompletion("capt u", undefined, api)).toBe("");
});

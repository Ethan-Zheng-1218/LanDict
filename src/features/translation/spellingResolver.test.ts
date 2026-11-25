import { expect, it, vi } from "vitest";
import { correctSpelling } from "./spellingResolver";
import { getQueryResult, type WordQueryResult } from "./translationService";

const empty = (query: string) => ({ ...getQueryResult(query), status: "empty" }) as WordQueryResult;
it("loads the unique local correction but preserves the original query", async () => {
  const api = {
    lookupSuggestions: vi.fn(async () => ["capture"]),
    lookupWords: vi.fn(async () => ({ capture: { ecdict: { word: "capture", translation: "v. 捕获", definition: "catch", phonetic: "", pos: "v:100", exchange: "" } } })),
    lookupLemmas: vi.fn(async () => ({})), reverseLookup: vi.fn(async () => []),
  };
  expect(await correctSpelling(empty("captuer"), api)).toMatchObject({ query: "captuer", correctedWord: "capture", status: "success", meaning: "捕获" });
  const exact = { ...empty("capture"), status: "success" as const };
  expect(await correctSpelling(exact, api)).toBe(exact);
  expect(api.lookupSuggestions).toHaveBeenCalledOnce();
});
it("offers ambiguous candidates without silently selecting one", async () => {
  const api = { lookupSuggestions: vi.fn(async () => ["cat", "cut"]), lookupWords: vi.fn(), lookupLemmas: vi.fn(), reverseLookup: vi.fn() };
  expect(await correctSpelling(empty("ctt"), api)).toMatchObject({ status: "empty", spellingSuggestions: ["cat", "cut"] });
  expect(api.lookupWords).not.toHaveBeenCalled();
});

// @vitest-environment node

import { expect, it } from "vitest";
import { lookupLemmas, lookupWords, reverseLookup } from "./dictionaryLookup";
import { suggestDictionaryWords } from "./dictionaryLookup";
import { spellingVariants } from "../src/features/translation/wordSuggestions";

it("returns the Oxford entry and the trimmed ECDICT entry side by side", async () => {
  const result = await lookupWords(["cat"]);
  expect(result.cat.oxford?.senses[0].translation).toBe("猫");
  expect(result.cat.ecdict?.word).toBe("cat");
});

it("answers unknown words with an empty record instead of throwing", async () => {
  const result = await lookupWords(["qqxzvnotaword"]);
  expect(result.qqxzvnotaword).toEqual({});
});

it("keys the result by lowercased word so a proper noun still reaches the trimmed dictionary", async () => {
  const result = await lookupWords(["America"]);
  expect(result.america?.ecdict?.word).toBe("America");
});

it("resolves Chinese through CC-CEDICT and keeps a sense position for Oxford", async () => {
  const hits = await reverseLookup("放弃");
  expect(hits.map((hit) => hit.word)).toContain("abandon");

  const cat = await reverseLookup("猫");
  expect(cat.some((hit) => hit.source === "oxford" && hit.senseIndex !== undefined)).toBe(true);
});

it("attaches the English frequency rank the strategy layer sorts by", async () => {
  const hits = await reverseLookup("放弃");
  const abandon = hits.find((hit) => hit.word === "abandon");
  const renounce = hits.find((hit) => hit.word === "renounce");
  expect(abandon?.rank).toBeGreaterThan(0);
  expect(abandon!.rank!).toBeLessThan(renounce?.rank ?? Number.MAX_SAFE_INTEGER);
});

it("maps an irregular inflection to its lemma", async () => {
  expect(await lookupLemmas(["ran"])).toEqual({ ran: "run" });
  expect(await lookupLemmas(["knives"])).toEqual({ knives: "knife" });
  expect(await lookupLemmas(["cats"])).toEqual({});
});

it("finds common local completions and exact spelling candidates", async () => {
  const completions = await suggestDictionaryWords("capt", []);
  expect(completions.length).toBeGreaterThan(0);
  expect(completions.every(word => word.startsWith("capt") && word.length > 4)).toBe(true);
  expect(await suggestDictionaryWords("", spellingVariants("captuer"))).toEqual(["capture"]);
  expect(await suggestDictionaryWords("%", [])).toEqual([]);
});

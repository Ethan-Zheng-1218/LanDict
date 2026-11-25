import { expect, it, vi } from "vitest";
import { getDefinitionPreview } from "./definitionPreview";

it("uses only exact local hits and takes at most two distinct parts of speech in dictionary order", async () => {
  const lookupWords = vi.fn(async () => ({ capture: { oxford: {
    word: "capture", headword: "capture", pos: "verb", collocations: [], collocationTranslations: {}, examples: [],
    senses: [
      { pos: "verb", translation: "捕获；俘获（敌人等）", definition: "catch" },
      { pos: "verb", translation: "吸引注意", definition: "attract" },
      { pos: "noun", translation: "捕获，俘虏", definition: "catching" },
      { pos: "adjective", translation: "其他", definition: "other" },
    ],
  } } }));
  expect(await getDefinitionPreview("capture", { lookupWords })).toBe("v. 捕获；n. 捕获");
  expect(lookupWords).toHaveBeenCalledWith(["capture"], undefined);
  expect(await getDefinitionPreview("captur", { lookupWords })).toBe("");
  expect(await getDefinitionPreview("capture this", { lookupWords })).toBe("");
  expect(lookupWords).toHaveBeenCalledTimes(2);
});

it("formats ECDICT exact definitions without performing word-form resolution", async () => {
  const lookupWords = vi.fn(async () => ({ dog: { ecdict: {
    word: "dog", translation: "n. 狗, 犬\nvt. 困扰, 尾随", definition: "dog", phonetic: "dɒɡ", pos: "n:80/v:20", exchange: "s:dogs",
  } } }));
  expect(await getDefinitionPreview("dog", { lookupWords })).toBe("n. 狗；v. 困扰");
  expect(await getDefinitionPreview("dogs", { lookupWords })).toBe("");
});

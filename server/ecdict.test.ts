// @vitest-environment node

import { describe, expect, it } from "vitest";

import { ECDICT_DATABASE_PATH, queryEcdict, queryEcdictLookup, queryEcdictReverse, queryWordFamily } from "./ecdict";

describe("ECDICT SQLite database", () => {
  it("uses the extracted stardict database", () => {
    expect(ECDICT_DATABASE_PATH.replaceAll("\\", "/")).toMatch(/data\/ecdict-sqlite-28\/stardict-slim\.db$/);
  });

  it.each([
    ["cat", "猫"],
    ["subsidy", "补助金"],
    ["transition", "转变"],
  ])("returns real dictionary data for %s", (word, expectedTranslation) => {
    const entry = queryEcdict(word);

    expect(entry).toMatchObject({ word });
    expect(entry?.phonetic).toBeTruthy();
    expect(entry?.pos).toBeTruthy();
    expect(entry?.translation).toContain(expectedTranslation);
    expect(entry?.definition).toBeTruthy();
    expect(entry?.exchange).toBeTruthy();
  });

  it.each(["back", "get", "match", "student", "don't"])("contains regression word %s", (word) => {
    expect(queryEcdict(word)?.word).toBe(word);
  });

  it.each([
    ["flowers", "flower"],
    ["written", "write"],
    ["children", "child"],
  ])("prefers the exact entry for the inflected search %s over its lemma %s", (word, lemma) => {
    const lookup = queryEcdictLookup(word);
    expect(lookup?.entry.word).toBe(word);
    expect(lookup?.entry.word).not.toBe(lemma);
    expect(lookup?.resolvedWord).toBeUndefined();
  });

  it("resolves an inflected form the trimmed dictionary does not carry through its lemma", () => {
    // 精简库只保留有词频排名的原型词，walked 这类变形词被剔除了，没有自己的条目，
    // 走 exchange 索引落到原型 walk。这是「词形还原」取代变形词条目的预期结果。
    const lookup = queryEcdictLookup("walked");
    expect(lookup?.entry.word).toBe("walk");
    expect(lookup?.resolvedWord).toBe("walk");
  });

  it("returns null for a word missing from the dictionary", () => {
    expect(queryEcdictLookup("qqxzvnotaword")).toBeNull();
  });

  it.each([["猫", "cat"]])("finds English candidates for the Chinese word %s", (query, expectedWord) => {
    expect(queryEcdictReverse(query).map((entry) => entry.word)).toContain(expectedWord);
  });

  it("returns multiple English candidates for a Chinese translation", () => {
    // felid 这类无词频排名的词已被精简剔除，只断言仍然保留的候选。
    expect(queryEcdictReverse("猫").map((entry) => entry.word)).toEqual(expect.arrayContaining(["cat", "feline"]));
  });

  it("keeps only direct base-word translations instead of substring matches", () => {
    const words = queryEcdictReverse("站立").map((entry) => entry.word);

    expect(words).toEqual(expect.arrayContaining(["stand", "arise"]));
    expect(words).not.toEqual(expect.arrayContaining(["taw", "KOed", "hunchs", "pointe"]));
  });

  it("keeps an exact entry even when its exchange metadata names a related lemma", () => {
    expect(queryEcdictLookup("better")).toMatchObject({ entry: { word: "better" } });
    expect(queryEcdictLookup("better")?.resolvedWord).toBeUndefined();
  });
});

describe("ECDICT word families", () => {
  it.each([
    ["running", "run"],
    ["children", "child"],
    ["better", "good"],
  ])("reads the lemma %s out of its own exchange metadata", (word, lemma) => {
    expect(queryWordFamily(word)?.lemma).toBe(lemma);
  });

  it("has no family for an inflected form that was trimmed away", () => {
    // ran / went / mice / knives 在 ECDICT 里词频为 0，被精简剔除。
    // 词族查询要求词本身有条目，因此返回 null；这些变形改由词形还原器负责，
    // 见 src/lib/lemmatizer 与 Task 10 的词族来源改造。
    for (const word of ["ran", "went", "mice", "knives"]) {
      expect(queryWordFamily(word)).toBeNull();
    }
  });

  it("expands a lemma into every inflected form it lists", () => {
    expect(queryWordFamily("run")?.forms).toEqual(expect.arrayContaining(["run", "ran", "running", "runs"]));
    expect(queryWordFamily("good")?.forms).toEqual(expect.arrayContaining(["good", "better", "best"]));
  });

  it("colours an inflected word with the family of the word it points at", () => {
    expect(queryWordFamily("children")?.forms).toEqual(expect.arrayContaining(["child", "children"]));
  });

  it("keeps a word without exchange metadata as its own single-form family", () => {
    expect(queryWordFamily("farthest")).toEqual({ lemma: "farthest", forms: ["farthest"] });
  });

  it.each(["qqxzvnotaword", "two words", "run!"])("returns null for the unusable query %s", (word) => {
    expect(queryWordFamily(word)).toBeNull();
  });

  it("resolves a form with no entry of its own through the inflection fallback", () => {
    expect(queryEcdictLookup("walked")).toMatchObject({
      entry: { word: "walk" },
      resolvedWord: "walk",
    });
  });

  it("never falls back to a word derived from the query instead of its lemma", () => {
    // 旧的 `%:ran/%` 扫描会命中条目 "rans"（`0:ran/1:s`），把 rans 当成 ran 的原形。
    // 精简之后 ran 没有自己的条目，应当落到真正的原型 run，绝不能是 rans。
    const lookup = queryEcdictLookup("ran");
    expect(lookup?.entry.word).toBe("run");
    expect(lookup?.entry.word).not.toBe("rans");
  });
});

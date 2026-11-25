import { describe, expect, it } from "vitest";

import { baseFormCandidates, buildWordMatcher, findVocabularyEntry, type WordFamilyMap } from "./wordMatch";

describe("baseFormCandidates", () => {
  it.each([
    ["running", "run"],
    ["runs", "run"],
    ["walked", "walk"],
    ["studies", "study"],
    ["boxes", "box"],
    ["making", "make"],
    ["stopped", "stop"],
    ["governments", "government"],
  ])("reduces %s to %s", (word, base) => {
    expect(baseFormCandidates(word)).toContain(base);
  });

  it("never invents a short word by stripping a suffix", () => {
    expect(baseFormCandidates("used")).not.toContain("us");
    expect(baseFormCandidates("gas")).not.toContain("ga");
  });

  it("leaves comparatives alone because the rule would break unrelated words", () => {
    // "-er" stripping would turn worker into work and computer into compute.
    expect(baseFormCandidates("worker")).not.toContain("work");
    expect(baseFormCandidates("computer")).not.toContain("compute");
  });
});

describe("buildWordMatcher", () => {
  const runFamily: WordFamilyMap = { run: ["run", "ran", "running", "runs"] };

  it("matches every form the ECDICT family lists", () => {
    const matches = buildWordMatcher(["run"], runFamily);
    for (const word of ["run", "ran", "running", "runs", "RUN"]) {
      expect(matches(word)).toBe(true);
    }
    expect(matches("rant")).toBe(false);
    expect(matches("brand")).toBe(false);
  });

  it("matches a lemma from a saved inflected form", () => {
    const matches = buildWordMatcher(["governments"], {});
    expect(matches("government")).toBe(true);
    expect(matches("governments")).toBe(true);
  });

  it("still matches regular inflections when no family data could be loaded", () => {
    const matches = buildWordMatcher(["walk", "study"], {});
    expect(matches("walked")).toBe(true);
    expect(matches("walks")).toBe(true);
    expect(matches("studying")).toBe(true);
    expect(matches("studies")).toBe(true);
    expect(matches("strolling")).toBe(false);
  });

  it("matches nothing against an empty notebook", () => {
    const matches = buildWordMatcher([], runFamily);
    expect(matches("run")).toBe(false);
  });
});

describe("findVocabularyEntry", () => {
  const entries = [{ id: "1", word: "run" }, { id: "2", word: "ran" }];
  const families: WordFamilyMap = { run: ["run", "ran", "running"] };

  it("prefers the entry that stores the clicked form itself", () => {
    expect(findVocabularyEntry(entries, "ran", families)?.id).toBe("2");
  });

  it("falls back to the lemma entry when the article uses a form that is not stored", () => {
    expect(findVocabularyEntry(entries, "running", families)?.id).toBe("1");
  });

  it("returns nothing when the word is not in the notebook", () => {
    expect(findVocabularyEntry(entries, "strolling", families)).toBeUndefined();
  });
});

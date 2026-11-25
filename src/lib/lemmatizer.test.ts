import { expect, it } from "vitest";
import { baseFormCandidates, IRREGULAR_FORMS, lemmaCandidates } from "./lemmatizer";

it("keeps the existing regular rule behavior", () => {
  expect(baseFormCandidates("studies")).toContain("study");
  expect(baseFormCandidates("stopped")).toContain("stop");
  expect(baseFormCandidates("running")).toContain("run");
  // 不能把 used 剥成 us。
  expect(baseFormCandidates("used")).not.toContain("us");
});

it("does not strip -er, which would turn worker into work", () => {
  expect(baseFormCandidates("worker")).not.toContain("work");
  expect(baseFormCandidates("computer")).not.toContain("compute");
});

it("puts the irregular base form first", () => {
  expect(lemmaCandidates("ran")[0]).toBe("run");
  expect(lemmaCandidates("children")[0]).toBe("child");
  expect(lemmaCandidates("better")[0]).toBe("good");
  expect(lemmaCandidates("mice")[0]).toBe("mouse");
  expect(lemmaCandidates("went")[0]).toBe("go");
});

it("offers derived-base candidates after the inflectional ones", () => {
  expect(lemmaCandidates("carefully")).toContain("careful");
  expect(lemmaCandidates("previously")).toContain("previous");
  expect(lemmaCandidates("happiness")).toContain("happy");
  expect(lemmaCandidates("organisation")).toContain("organise");
});

it("never returns the word itself", () => {
  for (const word of ["cat", "ran", "carefully"]) {
    expect(lemmaCandidates(word)).not.toContain(word);
  }
});

it("keeps the irregular table free of entries that a rule already covers", () => {
  // 表里只该放规则推不出来的；cats 这种加 s 能推出来的不该出现。
  expect(IRREGULAR_FORMS.cats).toBeUndefined();
  expect(IRREGULAR_FORMS.walked).toBeUndefined();
});

import { expect, it } from "vitest";
import { spellingVariants } from "./wordSuggestions";

it("includes single edits and adjacent transposition without changing the queried spelling", () => {
  expect(spellingVariants("captuer")).toContain("capture");
  expect(spellingVariants("capure")).toContain("capture");
  expect(spellingVariants("captuure")).toContain("capture");
  expect(spellingVariants("captare")).toContain("capture");
  expect(spellingVariants("capture")).not.toContain("capture");
  expect(spellingVariants("a")).toEqual([]);
  expect(spellingVariants("capture this")).toEqual([]);
});

import { beforeEach, describe, expect, it } from "vitest";

import { readStored, writeStored } from "./browserStorage";

describe("browser storage", () => {
  beforeEach(() => window.localStorage.clear());

  it("reads saved data from the previous application name without losing preferences", () => {
    window.localStorage.setItem("pudict.settings", JSON.stringify({ version: 1, data: { appearance: { theme: "black" } } }));
    expect(readStored("landict.settings", {})).toEqual({ appearance: { theme: "black" } });
    writeStored("landict.settings", { appearance: { theme: "lime" } });
    expect(readStored("landict.settings", {})).toEqual({ appearance: { theme: "lime" } });
  });

  it("writes and reads a versioned JSON envelope", () => {
    writeStored("landict.test.v1", { answer: 42 });

    expect(window.localStorage.getItem("landict.test.v1")).toBe(
      JSON.stringify({ version: 1, data: { answer: 42 } }),
    );
    expect(readStored("landict.test.v1", { answer: 0 })).toEqual({ answer: 42 });
  });

  it("returns the fallback when stored JSON is invalid", () => {
    window.localStorage.setItem("landict.test.v1", "{invalid");

    expect(readStored("landict.test.v1", [])).toEqual([]);
  });

  it("supports a validator for legacy or malformed data", () => {
    window.localStorage.setItem("landict.test.v1", JSON.stringify(["legacy"]));

    expect(readStored("landict.test.v1", [], (value): value is string[] => Array.isArray(value))).toEqual([
      "legacy",
    ]);
  });
});

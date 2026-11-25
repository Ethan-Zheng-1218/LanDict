// @vitest-environment node

import { describe, expect, it } from "vitest";

import { queryEcdict } from "../../../server/ecdict";
import { adaptEcdictRecord } from "./ecdictAdapter";

function canonical(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

describe("ECDICT adapter against bundled records", () => {
  it.each(["serendipity", "back", "get", "match", "student", "run", "set"])("normalizes %s without repeated display data", (word) => {
    const record = queryEcdict(word);
    expect(record).toBeTruthy();
    if (!record) return;

    const entry = adaptEcdictRecord(record);
    expect(new Set(entry.partOfSpeech.split(" · ")).size).toBe(entry.partOfSpeech ? entry.partOfSpeech.split(" · ").length : 0);
    for (const meaning of entry.meanings) {
      const keys = meaning.translations.map(canonical);
      expect(new Set(keys).size).toBe(keys.length);
    }
    const definitionKeys = entry.definitions.map(canonical);
    expect(new Set(definitionKeys).size).toBe(definitionKeys.length);
    expect(entry.meanings.flatMap((meaning) => meaning.translations).join(" ")).not.toMatch(/(?:^|\s)(?:noun|verb|adjective|adverb)\.?(?:\s|$)/i);
  });
});

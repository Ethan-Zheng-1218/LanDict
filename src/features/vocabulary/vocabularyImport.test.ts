import { describe, expect, it } from "vitest";

import { IMPORT_MISSING_MEANING, parseVocabularyImport } from "./vocabularyImport";

describe("vocabulary import", () => {
  it("reads a JSON list of plain strings and of word/meaning objects", () => {
    const result = parseVocabularyImport(JSON.stringify([
      { word: "groggy", meaning: "昏昏沉沉的" },
      { term: "creaky voice", definition: "沙哑的嗓音" },
      "serendipity",
    ]));

    expect(result.format).toBe("json");
    expect(result.items).toEqual([
      { word: "groggy", meaning: "昏昏沉沉的" },
      { word: "creaky voice", meaning: "沙哑的嗓音" },
      { word: "serendipity", meaning: IMPORT_MISSING_MEANING },
    ]);
    expect(result.missingMeaningCount).toBe(1);
  });

  it("accepts a wrapped word list and the documented meaning aliases", () => {
    const result = parseVocabularyImport(JSON.stringify({
      application: "PuDict English Companion",
      words: [{ vocabulary: "pivoting", translation: "转向" }, { english: "SIM card", chinese: "电话卡" }],
    }));

    expect(result.items).toEqual([
      { word: "pivoting", meaning: "转向" },
      { word: "SIM card", meaning: "电话卡" },
    ]);
  });

  it("reads plain lines with tab, comma or pipe delimiters and skips a header row", () => {
    const result = parseVocabularyImport(["单词\t释义", "resilient\t有韧性的", "curiosity, 好奇心", "wanderlust|旅行癖"].join("\n"));

    expect(result.format).toBe("text");
    expect(result.items).toEqual([
      { word: "resilient", meaning: "有韧性的" },
      { word: "curiosity", meaning: "好奇心" },
      { word: "wanderlust", meaning: "旅行癖" },
    ]);
  });

  it("skips words that are already saved and repeats inside the same file", () => {
    const result = parseVocabularyImport(["cat, 猫", "cat, 猫咪", "dog, 狗"].join("\n"), ["CAT"]);

    expect(result.items).toEqual([{ word: "dog", meaning: "狗" }]);
    expect(result.duplicateCount).toBe(2);
  });

  it("keeps the English headword when a Chinese meaning is glued to it", () => {
    expect(parseVocabularyImport("apple苹果").items).toEqual([{ word: "apple", meaning: "苹果" }]);
  });

  it("ignores sentences, Chinese-only rows and pure numbers", () => {
    const result = parseVocabularyImport([
      "I realized that I prefer working with people to doing academic research.",
      "成就感",
      "2026",
      "praised",
    ].join("\n"));

    expect(result.items).toEqual([{ word: "praised", meaning: IMPORT_MISSING_MEANING }]);
  });

  it("reports a PuDict chat export instead of importing its messages", () => {
    const result = parseVocabularyImport(JSON.stringify({
      schemaVersion: 1,
      application: "PuDict English Companion",
      exportedAt: "2026-10-14T03:44:57.543Z",
      sessions: [{ createdAt: "2026-10-13T05:02:01.052Z", messages: [{ role: "user", text: "I woke up groggy." }] }],
    }));

    expect(result.format).toBe("session-log");
    expect(result.items).toEqual([]);
  });

  it("returns an empty result for blank input", () => {
    expect(parseVocabularyImport("   \n  ")).toMatchObject({ format: "empty", items: [] });
  });
});

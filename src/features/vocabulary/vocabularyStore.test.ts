import { beforeEach, describe, expect, it } from "vitest";

import {
  addVocabularyEntries,
  listVocabulary,
  removeVocabulary,
  restoreVocabulary,
  saveVocabulary,
  updateVocabulary,
} from "./vocabularyStore";

describe("vocabulary store", () => {
  beforeEach(() => window.localStorage.clear());

  it("persists a word and restores it from localStorage", () => {
    saveVocabulary({
      word: "serendipity",
      phonetic: "/ˌserənˈdɪpəti/",
      meaning: "意外发现美好事物",
      example: "It was pure serendipity.",
      source: "Collins",
      sourceType: "lookup",
    });

    expect(listVocabulary()).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem("landict.vocabulary.v1") ?? "{}")).toMatchObject({
      version: 1,
      data: expect.arrayContaining([expect.objectContaining({ word: "serendipity" })]),
    });
  });

  it("does not create duplicate entries for the same word", () => {
    saveVocabulary({ word: "Serendipity", meaning: "旧释义", source: "Collins", sourceType: "lookup" });
    saveVocabulary({ word: "serendipity", meaning: "新释义", source: "Oxford", sourceType: "reading" });

    expect(listVocabulary()).toHaveLength(1);
    expect(listVocabulary()[0]).toMatchObject({ meaning: "新释义", sourceType: "reading" });
  });

  it("tracks study status and notes, then removes the word", () => {
    const entry = saveVocabulary({ word: "resilient", meaning: "有韧性的", source: "Reader", sourceType: "reading" });
    expect(entry.status).toBe("pending");
    updateVocabulary(entry.id, { status: "mastered", note: "常和 economy 搭配" });

    expect(listVocabulary()[0]).toMatchObject({ status: "mastered", note: "常和 economy 搭配" });

    removeVocabulary(entry.id);
    expect(listVocabulary()).toEqual([]);
  });

  it("persists structured dictionary fields and supplies defaults for older entries", () => {
    saveVocabulary({
      word: "subsidy",
      meaning: "补贴",
      definition: "Money paid by a government.",
      partOfSpeech: "noun",
      collocations: ["government subsidy"],
      britishPhonetic: "/ˈsʌbsədi/",
      americanPhonetic: "/ˈsʌbsədi/",
      source: "Collins",
      sourceType: "lookup",
    });

    expect(listVocabulary()[0]).toMatchObject({
      definition: "Money paid by a government.",
      partOfSpeech: "noun",
      collocations: ["government subsidy"],
      britishPhonetic: "/ˈsʌbsədi/",
    });

    window.localStorage.setItem("landict.vocabulary.v1", JSON.stringify({
      version: 1,
      data: [{ id: "legacy", word: "legacy", meaning: "旧数据" }],
    }));
    expect(listVocabulary()[0]).toMatchObject({
      word: "legacy",
      definition: "",
      collocations: [],
      partOfSpeech: "",
    });
  });

  it("migrates the legacy familiarity field onto the three study states", () => {
    window.localStorage.setItem("landict.vocabulary.v1", JSON.stringify({
      version: 1,
      data: [
        { id: "a", word: "unread", meaning: "没学过", familiarity: "new" },
        { id: "b", word: "inprogress", meaning: "在学", familiarity: "learning" },
        { id: "c", word: "known", meaning: "学过", familiarity: "familiar" },
      ],
    }));

    expect(listVocabulary().map((entry) => entry.status)).toEqual(["pending", "learning", "mastered"]);
  });

  it("adds imported words in bulk and skips the ones that already exist", () => {
    saveVocabulary({ word: "cat", meaning: "猫", source: "本地词库", sourceType: "lookup" });

    const result = addVocabularyEntries([
      { word: "cat", meaning: "猫", source: "导入", sourceType: "import" },
      { word: "Groggy", meaning: "昏昏沉沉的", source: "导入", sourceType: "import" },
    ]);

    expect(result).toEqual({ added: 1, skipped: 1 });
    expect(listVocabulary().map((entry) => entry.word)).toEqual(["groggy", "cat"]);
    expect(listVocabulary()[0]).toMatchObject({ status: "pending", source: "导入", sourceType: "import", meaning: "昏昏沉沉的" });
  });

  it("restores a removed word at its previous position", () => {
    saveVocabulary({ word: "first", meaning: "一", source: "本地词库", sourceType: "lookup" });
    const middle = saveVocabulary({ word: "middle", meaning: "二", source: "本地词库", sourceType: "lookup" });
    saveVocabulary({ word: "last", meaning: "三", source: "本地词库", sourceType: "lookup" });
    removeVocabulary(middle.id);

    restoreVocabulary({ ...middle, status: "learning" }, 1);

    expect(listVocabulary().map((entry) => entry.word)).toEqual(["last", "middle", "first"]);
    expect(listVocabulary().map((entry) => entry.status)).toEqual(["pending", "learning", "pending"]);
  });
});

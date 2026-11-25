import { describe, expect, it } from "vitest";

import { adaptEcdictRecord } from "./ecdictAdapter";

describe("ECDICT adapter", () => {
  it("groups translation lines by readable part of speech", () => {
    const entry = adaptEcdictRecord({
      word: "back",
      phonetic: "bæk",
      definition: "n. the rear surface of the human body\nv. be behind",
      translation: "n. 背部, 后面\nv. 支持, 倒退",
      pos: "r:50/v:30/n:20",
      exchange: "s:backs/i:backing/p:backed/3:backs/d:backed",
    });

    expect(entry.meanings).toEqual([
      { partOfSpeech: "noun", translations: ["背部", "后面"] },
      { partOfSpeech: "verb", translations: ["支持", "倒退"] },
    ]);
    expect(entry.partOfSpeech).toBe("adverb · verb · noun");
    expect(entry.definitions).toEqual(["the rear surface of the human body", "be behind"]);
    expect(entry.wordForms).toEqual([
      { label: "复数", value: "backs" },
      { label: "现在分词", value: "backing" },
      { label: "过去式", value: "backed" },
      { label: "第三人称单数", value: "backs" },
      { label: "过去分词", value: "backed" },
    ]);
  });

  it("interprets inflected-form metadata without exposing numeric codes", () => {
    const entry = adaptEcdictRecord({
      word: "children",
      phonetic: "'tʃildrən",
      definition: "n a young person of either sex\nn a human offspring",
      translation: "pl. 孩子, 孩子们",
      pos: "",
      exchange: "0:child/1:s/s:childrens",
    });

    expect(entry.meanings).toEqual([{ partOfSpeech: "noun", translations: ["孩子", "孩子们"] }]);
    expect(entry.wordForms).toEqual([{ label: "复数", value: "children", relatedWord: "child" }]);
    expect(entry.definitions).toEqual(["a young person of either sex", "a human offspring"]);
  });

  it("keeps contractions safe when optional fields are absent", () => {
    const entry = adaptEcdictRecord({
      word: "don't",
      phonetic: null,
      definition: null,
      translation: null,
      pos: null,
      exchange: null,
    });

    expect(entry.phonetic).toBe("—");
    expect(entry.meanings).toEqual([]);
    expect(entry.definitions).toEqual([]);
    expect(entry.wordForms).toEqual([]);
  });

  it("hides domain-tagged senses that general readers do not need", () => {
    const entry = adaptEcdictRecord({
      word: "manifestation",
      phonetic: ".mænifes'teiʃәn",
      definition: "n. a clear appearance",
      translation: "n. 显示, 证明, 示威运动\n[医] 表现, 表示",
      pos: "n:100",
      exchange: null,
    });

    expect(entry.meanings).toEqual([{ partOfSpeech: "noun", translations: ["显示", "证明", "示威运动"] }]);
    expect(entry.meaning).toBe("显示；证明；示威运动");
  });

  it("does not attach a translation marker for a part of speech absent from the record", () => {
    const entry = adaptEcdictRecord({
      word: "cat",
      phonetic: "kæt",
      definition: "n. feline mammal",
      translation: "n. 猫, 恶妇\nvi. 呕吐",
      pos: "n:100",
      exchange: null,
    });

    expect(entry.partOfSpeech).toBe("noun");
    expect(entry.meanings).toEqual([{ partOfSpeech: "noun", translations: ["猫", "恶妇"] }]);
    expect(entry.meaning).not.toContain("呕吐");
  });

  it("keeps domain-tagged senses when a term has no general sense at all", () => {
    const entry = adaptEcdictRecord({
      word: "myocardium",
      phonetic: null,
      definition: null,
      translation: "[医] 心肌",
      pos: null,
      exchange: null,
    });

    // The domain marker stays visible so it is clear the word only has a specialised sense.
    expect(entry.meanings).toEqual([{ partOfSpeech: "", translations: ["[医] 心肌"] }]);
  });

  it("omits domain-tagged computing senses when general senses exist", () => {
    const entry = adaptEcdictRecord({
      word: "mouse",
      phonetic: null,
      definition: null,
      translation: "n. 老鼠, 胆小羞怯的人\n[计] 鼠标\n[医] 鼠",
      pos: "n:100",
      exchange: null,
    });

    expect(entry.meanings).toEqual([{ partOfSpeech: "noun", translations: ["老鼠", "胆小羞怯的人"] }]);
  });

  it("keeps the five regression words readable against the bundled database", () => {
    const records = ["back", "get", "match", "student", "don't"].map((word) => ({
      word,
      phonetic: null,
      definition: word === "don't" ? null : `n. definition for ${word}`,
      translation: word === "don't" ? null : `n. ${word} translation`,
      pos: word === "don't" ? null : "n:100",
      exchange: null,
    }));
    for (const record of records) {
      const entry = adaptEcdictRecord(record);
      expect(entry.word).toBe(record.word);
      expect(entry.partOfSpeech).not.toMatch(/^[rnvj](?:\s|·|$)/);
      expect(entry.wordForms.join(" ")).not.toMatch(/(?:原形|原级) [rj]$/);
      expect(entry.meanings.every((meaning) => meaning.translations.every((item) => item.trim()))).toBe(true);
    }
  });

  it("normalizes overlapping POS markers and duplicate meanings", () => {
    const entry = adaptEcdictRecord({
      word: "serendipity",
      phonetic: "ˌserənˈdipitē",
      definition: "n. the luck of finding valuable things by chance\nn the luck of finding valuable things by chance!!\nn. an unexpected discovery",
      translation: "n. 偶然发现珍宝的运气；偶然发现珍宝的运气/才能\nnoun. 偶然发现珍宝的运气/才能",
      pos: "n:100",
      exchange: null,
    });

    expect(entry.partOfSpeech).toBe("noun");
    expect(entry.meanings).toEqual([{ partOfSpeech: "noun", translations: ["偶然发现珍宝的运气", "偶然发现珍宝的运气/才能"] }]);
    expect(entry.definitions).toEqual(["the luck of finding valuable things by chance", "an unexpected discovery"]);
  });

  it("keeps one normalized meaning group for every regression word", () => {
    const words = ["serendipity", "back", "get", "match", "student", "run", "set"];
    for (const word of words) {
      const entry = adaptEcdictRecord({
        word,
        phonetic: null,
        definition: "n. first definition\nn second definition\nn. first definition!",
        translation: "n. first meaning, second meaning\nnoun. first meaning",
        pos: "n:100",
        exchange: null,
      });
      expect(entry.meanings.map((meaning) => meaning.partOfSpeech)).toEqual(["noun"]);
      expect(entry.meanings[0]?.translations).toEqual(["first meaning", "second meaning"]);
      expect(new Set(entry.definitions.map((item) => item.toLowerCase().replace(/[^a-z]/g, ""))).size).toBe(entry.definitions.length);
    }
  });
});

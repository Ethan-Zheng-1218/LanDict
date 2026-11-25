import { describe, expect, it, vi } from "vitest";
import { lemmaCandidates } from "../../lib/lemmatizer";
import { lookupWords, reverseLookup } from "../../../server/dictionaryLookup";
import {
  REVERSE_LOOKUP_LIMIT,
  resolveChineseQuery,
  resolveWordQuery,
  type DictionaryAtomicApi,
} from "./dictionaryResolver";

const oxfordHit = (translation: string, pos = "noun", word = "x") => ({
  oxford: {
    word,
    headword: word,
    pos,
    senses: [{ pos, definition: "a definition.", translation }],
    collocations: [],
    collocationTranslations: {},
    examples: [],
  },
});

function api(lookupWords: DictionaryAtomicApi["lookupWords"]): DictionaryAtomicApi {
  return {
    lookupWords,
    reverseLookup: vi.fn().mockResolvedValue([]),
    lookupLemmas: vi.fn().mockResolvedValue({}),
  };
}

it("prefers the Oxford entry over the ECDICT one", async () => {
  const lookup = vi.fn().mockResolvedValue({
    cat: { ...oxfordHit("猫"), ecdict: { word: "cat", translation: "n. 猫" } },
  });
  const result = await resolveWordQuery("cat", api(lookup));
  expect(result.status).toBe("success");
  expect(result.meaning).toBe("猫");
  expect(result.source).toBe("牛津高阶");
});

it("sends the surface form and every candidate in a single round trip", async () => {
  const lookup = vi.fn().mockResolvedValue({ stopped: {}, stop: oxfordHit("停止", "verb", "stop") });
  const result = await resolveWordQuery("stopped", api(lookup));
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(lookup).toHaveBeenCalledWith(["stopped", ...lemmaCandidates("stopped")], undefined);
  expect(result.meaning).toBe("停止");
  expect(result.resolvedWord).toBe("stop");
});

it("reports an unknown word as empty rather than throwing", async () => {
  const lookup = vi.fn().mockResolvedValue({ qqxzvnotaword: {} });
  const result = await resolveWordQuery("qqxzvnotaword", api(lookup));
  expect(result.status).toBe("empty");
  expect(result.panels[0].body).toContain("暂未收录");
});

it("accepts hyphenated and apostrophe words", async () => {
  const lookup = vi.fn().mockResolvedValue({ "mother-in-law": oxfordHit("岳母"), "don't": oxfordHit("不要") });
  await expect(resolveWordQuery("mother-in-law", api(lookup))).resolves.toMatchObject({ status: "success" });
  await expect(resolveWordQuery("don't", api(lookup))).resolves.toMatchObject({ status: "success" });
});

it("lowercases the lookup key so a proper noun reaches the trimmed ECDICT", async () => {
  const lookup = vi.fn().mockResolvedValue({ america: { ecdict: { word: "America", translation: "n. 美国", phonetic: "əˈmerɪkə" } } });
  const result = await resolveWordQuery("America", api(lookup));
  expect(lookup).toHaveBeenCalledWith(["America", ...lemmaCandidates("America")], undefined);
  expect(result.status).toBe("success");
  expect(result.meaning).toContain("美国");
});

it("does not treat an Oxford idiom as a meaning of the word", async () => {
  const lookup = vi.fn().mockResolvedValue({
    cat: {
      oxford: {
        word: "cat",
        headword: "cat",
        pos: "noun",
        senses: [
          { pos: "noun", definition: "a small animal.", translation: "猫" },
          { pos: "noun", definition: "be the cat's whiskers.", translation: "最棒的东西", idiom: true },
        ],
        collocations: [],
        collocationTranslations: {},
        examples: [],
      },
    },
  });
  const result = await resolveWordQuery("cat", api(lookup));
  expect(result.meaning).toBe("猫");
  expect(result.meaning).not.toContain("最棒");
});

it("keeps the platform pronunciation when the api supplies one", async () => {
  const lookup = vi.fn().mockResolvedValue({ cat: { ...oxfordHit("猫"), ecdict: { word: "cat", translation: "n. 猫", phonetic: "kæt" } } });
  const withIpa = {
    ...api(lookup),
    lookupPronunciation: vi.fn().mockResolvedValue({ britishIpa: "/kæt/", americanIpa: "/kæt/", americanAudioUrl: "https://example.test/cat.mp3" }),
  };
  const result = await resolveWordQuery("cat", withIpa);
  expect(result.britishPhonetic).toBe("/kæt/");
  expect(result.americanAudioUrl).toBe("https://example.test/cat.mp3");
});

// ---------------------------------------------------------------------------
// 中文反查排序
// ---------------------------------------------------------------------------

function reverseApi(hits: Awaited<ReturnType<DictionaryAtomicApi["reverseLookup"]>>): DictionaryAtomicApi {
  return {
    lookupWords: vi.fn().mockResolvedValue({}),
    reverseLookup: vi.fn().mockResolvedValue(hits),
    lookupLemmas: vi.fn().mockResolvedValue({}),
  };
}

const words = (result: Awaited<ReturnType<typeof resolveChineseQuery>>) =>
  result.panels[0].body.split("\n").map((line) => line.split("\u3000")[0]);

it("puts each candidate on its own line followed by its own Chinese meaning", async () => {
  const result = await resolveChineseQuery("放弃", {
    lookupWords: vi.fn().mockResolvedValue({
      abandon: { ecdict: { word: "abandon", translation: "vt. 放弃, 抛弃\nn. 放任" } },
      renounce: {
        oxford: {
          word: "renounce",
          headword: "renounce",
          pos: "verb",
          senses: [{ pos: "verb", definition: "to give up.", translation: "放弃（权利等）" }],
          collocations: [],
          collocationTranslations: {},
          examples: [],
        },
      },
    }),
    reverseLookup: vi.fn().mockResolvedValue([
      { word: "abandon", source: "cedict", rank: 2057 },
      { word: "renounce", source: "cedict", rank: 9856 },
    ]),
    lookupLemmas: vi.fn().mockResolvedValue({}),
  });

  // 牛津的义项翻译优先，其次 ECDICT 的第一段（剥掉词性前缀）。
  expect(result.panels[0].body).toBe("abandon　放弃\nrenounce　放弃（权利等）");
});

it("puts abandon first for 放弃 and keeps the dictionary above the inverted index", async () => {
  const result = await resolveChineseQuery("放弃", reverseApi([
    { word: "renounce", source: "cedict", rank: 9856 },
    { word: "abandon", source: "cedict", rank: 2057 },
    { word: "give up", source: "cedict" },
    // 牛津的 get 有上百个义项，第 112 个义项里带过「放弃」，词频却高得多。
    { word: "get", source: "oxford", senseIndex: 112, rank: 41 },
  ]));
  expect(words(result)[0]).toBe("abandon");
  expect(words(result).indexOf("get")).toBeGreaterThan(words(result).indexOf("give up"));
});

it("ranks a common multi-word answer above a rare single word", async () => {
  const result = await resolveChineseQuery("生气", reverseApi([
    { word: "vitality", source: "cedict", rank: 8639 },
    { word: "get angry", source: "cedict" },
  ]));
  expect(words(result)[0]).toBe("get angry");
});

it("keeps the common reading of 猫 first", async () => {
  const result = await resolveChineseQuery("猫", reverseApi([
    { word: "modem", source: "cedict", rank: 9165 },
    { word: "cat", source: "cedict", rank: 1712 },
    { word: "feline", source: "oxford", senseIndex: 0, rank: 23868 },
  ]));
  expect(words(result)[0]).toBe("cat");
});

it("deduplicates a word that arrives from more than one source", async () => {
  const result = await resolveChineseQuery("猫", reverseApi([
    { word: "cat", source: "oxford", senseIndex: 0, rank: 1712 },
    { word: "cat", source: "cedict", rank: 1712 },
    { word: "moggie", source: "oxford", senseIndex: 0, rank: 37654 },
  ]));
  expect(words(result).filter((word) => word === "cat")).toHaveLength(1);
});

it("applies the six entry limit", async () => {
  const many = Array.from({ length: 20 }, (_, index) => ({
    word: `word${index}`,
    source: "oxford" as const,
    senseIndex: index,
    rank: 1000 + index,
  }));
  const result = await resolveChineseQuery("提高", reverseApi(many));
  expect(words(result)).toHaveLength(REVERSE_LOOKUP_LIMIT);
});

it("reports an unanswered Chinese term as empty", async () => {
  const result = await resolveChineseQuery("没有收录", reverseApi([]));
  expect(result.status).toBe("empty");
});

// 以下用真实构建产物跑，锁定效果。改动排序后如果这些断言变红，说明反查质量下降了。
// 依赖 data/ 下已构建的三份词库，与 server/dictionaryLookup.test.ts 的前提相同。
describe("反查排序的真实数据回归", () => {
  const realApi: DictionaryAtomicApi = { lookupWords, reverseLookup, lookupLemmas: async () => ({}) };
  const first = async (term: string) => words(await resolveChineseQuery(term, realApi))[0];
  const all = (term: string) => resolveChineseQuery(term, realApi).then(words);

  it.each([
    ["放弃", "abandon"],
    ["跑步", "run"],
    ["提高", "raise"],
    ["睡觉", "sleep"],
    ["银行", "bank"],
    ["猫", "cat"],
    ["电脑", "computer"],
  ])("puts %s ahead with %s", async (term, expected) => {
    expect(await first(term)).toBe(expected);
  });

  it("keeps abandon and give up on the first screen for 放弃", async () => {
    expect(await all("放弃")).toEqual(expect.arrayContaining(["abandon", "give up"]));
  });

  it("returns a real word for 骚扰", async () => {
    expect(await all("骚扰")).toEqual(expect.arrayContaining(["harass"]));
  });
});

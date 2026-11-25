import { expect, it } from "vitest";
import { parseCedictEntries, toReverseIndex } from "./cedict.mjs";

const SAMPLE = [
  "#! this line is a comment",
  "放棄 放弃 [fang4 qi4] /to renounce; to abandon; to give up/",
  "貓 猫 [mao1] /cat (CL:隻|只[zhi1])/(dialect) to hide oneself/(loanword) (coll.) modem/",
  "",
].join("\r\n");

it("parses traditional, simplified and pinyin and skips comment lines", () => {
  const entries = parseCedictEntries(SAMPLE);
  expect(entries).toHaveLength(2);
  expect(entries[0]).toEqual({
    traditional: "放棄",
    simplified: "放弃",
    pinyin: "fang4 qi4",
    glosses: ["to renounce; to abandon; to give up"],
  });
  expect(entries[1].glosses).toEqual([
    "cat (CL:隻|只[zhi1])",
    "(dialect) to hide oneself",
    "(loanword) (coll.) modem",
  ]);
});

it("indexes simplified terms with de-prefixed English glosses", () => {
  const index = toReverseIndex(parseCedictEntries(SAMPLE));
  expect(index.get("放弃")).toEqual(["renounce", "abandon", "give up"]);
  expect(index.get("猫")).toEqual(["cat", "hide oneself", "modem"]);
});

it("drops glosses that carry no usable English term", () => {
  const index = toReverseIndex(parseCedictEntries("X X [x] /used in 貓腰|猫腰[mao2 yao1]/"));
  expect(index.has("X")).toBe(false);
});

it("drops long descriptive phrases so only lookup-sized terms survive", () => {
  const index = toReverseIndex(parseCedictEntries("X X [x] /a traditional Chinese festival celebrated in spring/"));
  expect(index.has("X")).toBe(false);
});

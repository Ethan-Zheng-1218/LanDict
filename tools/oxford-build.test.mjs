import { expect, it } from "vitest";
import { parseOxfordEntry, extractHanziIndex } from "./oxford-build.mjs";

const CAT = '<font color=blue size=+2><b><font color=red size=5>♠ </font>cat</b></font> / <FONT color=red>kAt</FONT> / <br>'
  + '<font color=red>◙ </font><font color=darkred font=+1><b><i>noun </i></b></font><br>'
  + ' 1. a small animal with soft fur.<br>'
  + '<font color=#FF5000>• 猫</font>:<br>'
  + '<SPAN style="color:#04F">&nbsp;»cat food </SPAN><br>'
  + '<font style="color:#039;font-size:90%">&nbsp;&nbsp;猫食品 </font><br>'
  + '--› see also<b> <a href="entry://kitten">kitten</a> </b><br>'
  + ' 2. a wild animal of the cat family<br>'
  + '<font color=#FF5000>• 猫科动物</font>';

const RAN = '<b>ran </b>pt of<b> <a href="entry://run">run</a> </b>';
const WHISKER = '<font color=#FF5000>• (猫、鼠等的)须</font>';

it("reads the sense definition, translation and part of speech", () => {
  const entry = parseOxfordEntry(CAT, "cat");
  expect(entry.pos).toBe("noun");
  expect(entry.senses).toEqual([
    { pos: "noun", definition: "1. a small animal with soft fur.", translation: "猫" },
    { pos: "noun", definition: "2. a wild animal of the cat family", translation: "猫科动物" },
  ]);
});

it("does not let the headword and phonetic text leak into the first definition", () => {
  expect(parseOxfordEntry(CAT, "cat").senses[0].definition).not.toContain("kAt");
});

it("strips the key-word symbol from the headword", () => {
  expect(parseOxfordEntry(CAT, "cat").headword).toBe("cat");
});

it("drops the cross-reference line instead of merging it into the next definition", () => {
  const entry = parseOxfordEntry(CAT, "cat");
  expect(entry.senses[1].definition).toBe("2. a wild animal of the cat family");
  expect(entry.senses[1].definition).not.toContain("kitten");
});

it("marks only the senses after 【IDIOMS】 as idioms", () => {
  const source = '<font color=darkred><b><i>verb </i></b></font>'
    + ' 1. to leave.【VN】<br><font color=#FF5000>• 离开</font>'
    + '<DIV style="color:red"><b>【IDIOMS】</b></DIV>'
    + '◘ abandon ship<br><font color=#FF5000>• 弃船</font>';
  const entry = parseOxfordEntry(source, "abandon");
  expect(entry.senses[0]).not.toHaveProperty("idiom");
  expect(entry.senses[1]).toMatchObject({ translation: "弃船", idiom: true });
});

it("collects the collocation with its Chinese translation", () => {
  const entry = parseOxfordEntry(CAT, "cat");
  expect(entry.collocations).toContain("cat food");
  expect(entry.collocationTranslations["cat food"]).toBe("猫食品");
});

it("records the lemma a plain inflection points at", () => {
  expect(parseOxfordEntry(RAN, "ran").lemmaBase).toBe("run");
});

it("does not index Chinese that only appears inside a parenthetical qualifier", () => {
  const index = extractHanziIndex([parseOxfordEntry(WHISKER, "whisker")]);
  expect(index).toEqual([{ term: "须", word: "whisker", senseIndex: 0 }]);
});

it("keeps the sense position when a term appears in several senses", () => {
  const index = extractHanziIndex([parseOxfordEntry(CAT, "cat")]);
  expect(index.find((item) => item.term === "猫")).toMatchObject({ senseIndex: 0 });
  expect(index.find((item) => item.term === "猫科动物")).toMatchObject({ senseIndex: 1 });
});

it("does not index a term that only shows up in a late sense", () => {
  // 实测来源：牛津的 equal 第 5 个义项里提到「无敌」，收录它会让查「无敌」的人看到 equal。
  const html = '<font color=darkred><b><i>adj. </i></b></font>'
    + '1. a<font color=#FF5000>• 甲</font>'
    + '2. b<font color=#FF5000>• 乙</font>'
    + '3. c<font color=#FF5000>• 丙</font>'
    + '4. d<font color=#FF5000>• 丁</font>'
    + '5. being without 无敌<font color=#FF5000>• 无敌</font>';
  const terms = extractHanziIndex([parseOxfordEntry(html, "equal")]).map((item) => item.term);
  expect(terms).toEqual(["甲", "乙", "丙"]);
  expect(terms).not.toContain("无敌");
});

it("does not index an idiom translation as if it were a sense", () => {
  const html = '<font color=darkred><b><i>noun </i></b></font>1. a small animal.<font color=#FF5000>• 猫</font>'
    + '<DIV style="color:red"><b>【IDIOMS】</b></DIV>'
    + '◘ be the cat\'s whiskers<font color=#FF5000>• 最棒的东西</font>';
  const terms = extractHanziIndex([parseOxfordEntry(html, "cat")]).map((item) => item.term);
  expect(terms).toEqual(["猫"]);
});

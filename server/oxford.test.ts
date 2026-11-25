import { describe, expect, it } from "vitest";

import * as oxford from "./oxford";

type OxfordPronunciation = { britishIpa: string; americanIpa: string };
type OxfordModule = typeof oxford & { queryOxfordPronunciation?: (word: string) => OxfordPronunciation };

const dictionary = oxford as OxfordModule;

describe("Oxford pronunciation lookup", () => {
  it("decodes the Oxford British and North American headword pronunciations", () => {
    expect(dictionary.queryOxfordPronunciation).toBeTypeOf("function");
    expect(dictionary.queryOxfordPronunciation?.("schedule")).toEqual({
      britishIpa: "/ˈʃedjuːl/",
      americanIpa: "/ˈskedʒuːl/",
    });
  });

  it("reuses Oxford's British IPA when no NAmE headword variant is shown", () => {
    expect(dictionary.queryOxfordPronunciation?.("speak")).toEqual({
      britishIpa: "/spiːk/",
      americanIpa: "/spiːk/",
    });
  });

  it("decodes Kingsoft's vowel and consonant code points into Unicode IPA", () => {
    expect(dictionary.queryOxfordPronunciation?.("think")).toEqual({
      britishIpa: "/θɪŋk/",
      americanIpa: "/θɪŋk/",
    });
    expect(dictionary.queryOxfordPronunciation?.("good")).toEqual({
      britishIpa: "/ɡʊd/",
      americanIpa: "/ɡʊd/",
    });
    expect(dictionary.queryOxfordPronunciation?.("bird")).toEqual({
      britishIpa: "/bɜːd/",
      americanIpa: "/bɜːrd/",
    });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchIpaPronunciations, fetchLocalWordPronunciation, fetchOnlinePronunciations, fetchWordPronunciation, parseWiktionaryPronunciation, pronunciationAudioLabel, youdaoAudioUrl } from "./pronunciationService";

describe("DictionaryAPI pronunciation service", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["hello", { gb: "https://audio.example/hello-uk.mp3", us: "https://audio.example/hello-us.mp3" }],
    ["student", { gb: "https://audio.example/student-gb.mp3", us: "https://audio.example/student-us.mp3" }],
    ["schedule", { gb: "https://audio.example/schedule-uk.mp3", us: "https://audio.example/schedule-us.mp3" }],
  ])("selects GB/UK and US audio for %s", async (word, expected) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ phonetics: [
        { audio: expected.gb },
        { audio: expected.us },
      ] }],
    }));

    await expect(fetchOnlinePronunciations(word)).resolves.toEqual(expected);
  });

  it("keeps a partial result when only one accent is provided", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ phonetics: [{ audio: "https://audio.example/apple-us.mp3" }] }],
    }));

    await expect(fetchOnlinePronunciations("apple")).resolves.toEqual({ us: "https://audio.example/apple-us.mp3" });
  });

  it("keeps accent-specific IPA text alongside the audio URLs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ phonetics: [
        { text: "/ˈɡær.ɑːʒ/", audio: "https://audio.example/garage-uk.mp3" },
        { text: "/ɡəˈrɑːʒ/", audio: "https://audio.example/garage-us.mp3" },
      ] }],
    }));

    await expect(fetchOnlinePronunciations("garage")).resolves.toEqual({
      gb: "https://audio.example/garage-uk.mp3",
      us: "https://audio.example/garage-us.mp3",
      gbText: "/ˈɡær.ɑːʒ/",
      usText: "/ɡəˈrɑːʒ/",
    });
  });

  it("returns no audio on API errors so the caller can use system TTS", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(fetchOnlinePronunciations("water")).resolves.toEqual({});
  });

  it("selects one IPA pronunciation for each accent from Wiktionary", () => {
    expect(parseWiktionaryPronunciation(`===Pronunciation===
* {{IPA|en|/ˈɡæ.ɹɪdʒ/|/ˈɡæ.ɹɑːʒ/|a=RP}}
* {{IPA|en|/ɡəˈɹɑʒ/|/ɡɹɑʒ/|a=US}}`)).toEqual({
      gbText: "/ˈɡæ.ɹɪdʒ/",
      usText: "/ɡəˈɹɑʒ/",
    });
  });

  it("recognizes combined RP and GA accent labels", () => {
    expect(parseWiktionaryPronunciation(`===Pronunciation===
* {{IPA|en|/maɪnd/|a=RP,GA}}`)).toEqual({
      gbText: "/maɪnd/",
      usText: "/maɪnd/",
    });
  });

  it("loads IPA from the local pronunciation proxy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ wikitext: "===Pronunciation===\n* {{IPA|en|/ˈɡæ.ɹɪdʒ/|a=RP}}\n* {{IPA|en|/ɡəˈɹɑʒ/|a=US}}" }),
    }));

    await expect(fetchIpaPronunciations("garage")).resolves.toEqual({ gbText: "/ˈɡæ.ɹɪdʒ/", usText: "/ɡəˈɹɑʒ/" });
  });

  it("accepts Wiktionary's real parse.wikitext response shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ parse: { wikitext: { "*": "===Pronunciation===\n* {{IPA|en|/ˈɡæ.ɹɪdʒ/|a=RP}}\n* {{IPA|en|/ɡəˈɹɑʒ/|a=US}}" } } }),
    }));

    await expect(fetchIpaPronunciations("garage")).resolves.toEqual({ gbText: "/ˈɡæ.ɹɪdʒ/", usText: "/ɡəˈɹɑʒ/" });
  });

  it("prefers Oxford IPA and routes each accent to its designated audio source", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/local-dictionary")) return Promise.resolve({ ok: true, json: async () => ({
        oxfordPronunciation: { britishIpa: "/ˈʃedjuːl/", americanIpa: "/ˈskedʒuːl/" },
        merriamWebster: { pronunciation: "/ˈske-jəl/", audioUrl: "https://mw.example/schedule.mp3" },
      }) });
      if (url.startsWith("/api/ipa-pronunciation")) return Promise.resolve({ ok: true, json: async () => ({
        wikitext: "===Pronunciation===\n* {{IPA|en|/fallback-gb/|a=RP}}\n* {{IPA|en|/fallback-us/|a=US}}",
      }) });
      return Promise.resolve({ ok: true, json: async () => [{ phonetics: [
        { text: "/online-gb/", audio: "https://audio.example/schedule-uk.mp3" },
        { text: "/online-us/", audio: "https://audio.example/schedule-us.mp3" },
      ] }] });
    }));

    await expect(fetchWordPronunciation("schedule")).resolves.toEqual({
      british: { ipa: "/ˈʃedjuːl/", ipaSource: "oxford", audioUrl: "https://audio.example/schedule-uk.mp3", audioSource: "dictionary-api" },
      american: { ipa: "/ˈskedʒuːl/", ipaSource: "oxford", audioUrl: "https://mw.example/schedule.mp3", audioSource: "merriam-webster" },
    });
  });

  it("reuses Oxford's shared IPA without requesting a free IPA fallback", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/local-dictionary")) return Promise.resolve({ ok: true, json: async () => ({
        oxfordPronunciation: { britishIpa: "/spiːk/", americanIpa: "/spiːk/" },
        merriamWebster: { pronunciation: "/ˈspēk/", audioUrl: "https://mw.example/speak.mp3" },
      }) });
      if (url.startsWith("/api/ipa-pronunciation")) throw new Error("shared Oxford IPA must not request a fallback");
      return Promise.resolve({ ok: true, json: async () => [{ phonetics: [] }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWordPronunciation("speak")).resolves.toMatchObject({
      british: { ipa: "/spiːk/", ipaSource: "oxford" },
      american: { ipa: "/spiːk/", ipaSource: "oxford", audioUrl: "https://mw.example/speak.mp3", audioSource: "merriam-webster" },
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/ipa-pronunciation"), expect.anything());
  });

  it("uses free IPA only when Oxford has no usable headword IPA", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/local-dictionary")) return Promise.resolve({ ok: true, json: async () => ({
        oxfordPronunciation: { britishIpa: "", americanIpa: "" },
        merriamWebster: { pronunciation: "/ˈkat/", audioUrl: "https://mw.example/cat.mp3" },
      }) });
      if (url.startsWith("/api/ipa-pronunciation")) return Promise.resolve({ ok: true, json: async () => ({
        wikitext: "===Pronunciation===\n* {{IPA|en|/kæt/|a=RP,GA}}",
      }) });
      return Promise.resolve({ ok: true, json: async () => [{ phonetics: [] }] });
    }));

    await expect(fetchWordPronunciation("cat")).resolves.toMatchObject({
      american: { ipa: "/kæt/", ipaSource: "fallback", audioUrl: "https://mw.example/cat.mp3", audioSource: "merriam-webster" },
    });
  });

  it("returns local Oxford IPA before slow online fallbacks finish", async () => {
    let resolveOnline: (() => void) | undefined;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/local-dictionary")) return Promise.resolve({ ok: true, json: async () => ({
        oxfordPronunciation: { britishIpa: "/ˈlæŋɡwɪdʒ/", americanIpa: "/ˈlæŋɡwɪdʒ/" },
        merriamWebster: { audioUrl: "https://mw.example/language.mp3" },
      }) });
      return new Promise((resolve) => { resolveOnline = () => resolve({ ok: true, json: async () => ({}) }); });
    }));

    const result = await Promise.race([
      fetchWordPronunciation("language", undefined, () => undefined),
      new Promise<"timed-out">((resolve) => window.setTimeout(() => resolve("timed-out"), 25)),
    ]);

    expect(result).toEqual({
      /* 英式先给有道的录音地址：它不需要联网就能拼出来，所以本地这一份结果里已经带上了 */
      british: { ipa: "/ˈlæŋɡwɪdʒ/", ipaSource: "oxford", audioUrl: "https://dict.youdao.com/dictvoice?audio=language&type=1", audioSource: "youdao" },
      american: { ipa: "/ˈlæŋɡwɪdʒ/", ipaSource: "oxford", audioUrl: "https://mw.example/language.mp3", audioSource: "merriam-webster" },
    });
    resolveOnline?.();
  });

  it("falls back to the British IPA when the American IPA from Oxford is a fragment", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/local-dictionary")) return Promise.resolve({ ok: true, json: async () => ({
        oxfordPronunciation: { britishIpa: "/kənˈsɜːvətɪv/", americanIpa: "/-ˈsɜːrv-/" },
      }) });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    }));

    await expect(fetchWordPronunciation("conservative")).resolves.toMatchObject({
      british: { ipa: "/kənˈsɜːvətɪv/" },
      american: { ipa: "/kənˈsɜːvətɪv/" },
    });
  });

  it("keeps distinct British and American IPA values when both are complete", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/local-dictionary")) return Promise.resolve({ ok: true, json: async () => ({
        oxfordPronunciation: { britishIpa: "/iːt/", americanIpa: "/iːt/" },
      }) });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    }));

    await expect(fetchWordPronunciation("eat")).resolves.toMatchObject({
      british: { ipa: "/iːt/" },
      american: { ipa: "/iːt/" },
    });
  });

  it("carries the local ECDICT phonetic through when Oxford has no headword IPA", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      oxfordPronunciation: { britishIpa: "", americanIpa: "" },
      britishPhonetic: "/prә'test/",
    }) }));

    await expect(fetchLocalWordPronunciation("protest")).resolves.toMatchObject({
      britishPhonetic: "",
      americanPhonetic: "",
      ecdictPhonetic: "/prә'test/",
    });
  });

  it("falls back to the local ECDICT phonetic when every online IPA source is empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/local-dictionary")) return Promise.resolve({ ok: true, json: async () => ({
        oxfordPronunciation: { britishIpa: "", americanIpa: "" },
        britishPhonetic: "/.mænifes'teiʃәn/",
      }) });
      if (url.startsWith("/api/ipa-pronunciation")) return Promise.resolve({ ok: true, json: async () => ({ wikitext: "" }) });
      return Promise.resolve({ ok: true, json: async () => [{ phonetics: [] }] });
    }));

    await expect(fetchWordPronunciation("manifestation")).resolves.toMatchObject({
      british: { ipa: "/.mænifes'teiʃәn/", ipaSource: "fallback" },
      american: { ipa: "/.mænifes'teiʃәn/", ipaSource: "fallback" },
    });
  });

  it("拼出有道的真人录音地址，英式 type=1、美式 type=2", () => {
    expect(youdaoAudioUrl("government", "uk")).toBe("https://dict.youdao.com/dictvoice?audio=government&type=1");
    expect(youdaoAudioUrl("Government", "us")).toBe("https://dict.youdao.com/dictvoice?audio=government&type=2");
    expect(youdaoAudioUrl("take sth into account", "uk")).toBe("https://dict.youdao.com/dictvoice?audio=take%20sth%20into%20account&type=1");
  });

  it("免费英式音频没有时，英式改用有道录音", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/local-dictionary")) return Promise.resolve({ ok: true, json: async () => ({
        oxfordPronunciation: { britishIpa: "/ˈɡʌvənmənt/", americanIpa: "/-vərn-/" },
      }) });
      if (url.startsWith("/api/ipa-pronunciation")) return Promise.resolve({ ok: true, json: async () => ({ wikitext: "" }) });
      /* dictionaryapi 只回了美式，英式没有 */
      return Promise.resolve({ ok: true, json: async () => [{ phonetics: [{ audio: "https://audio.example/government-us.mp3" }] }] });
    }));

    await expect(fetchWordPronunciation("government")).resolves.toMatchObject({
      british: { audioUrl: "https://dict.youdao.com/dictvoice?audio=government&type=1", audioSource: "youdao" },
      american: { audioUrl: "https://dict.youdao.com/dictvoice?audio=government&type=2", audioSource: "youdao" },
    });
  });

  it("韦氏音频在时美式仍然优先用韦氏，英式用有道", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/local-dictionary")) return Promise.resolve({ ok: true, json: async () => ({
        oxfordPronunciation: { britishIpa: "/ˈɡʌvənmənt/", americanIpa: "/-vərn-/" },
        merriamWebster: { pronunciation: "/ˈgə-vər(n)-mənt/", audioUrl: "https://mw.example/government.mp3" },
      }) });
      if (url.startsWith("/api/ipa-pronunciation")) return Promise.resolve({ ok: true, json: async () => ({ wikitext: "" }) });
      return Promise.resolve({ ok: true, json: async () => [{ phonetics: [] }] });
    }));

    await expect(fetchWordPronunciation("government")).resolves.toMatchObject({
      british: { audioSource: "youdao" },
      american: { audioUrl: "https://mw.example/government.mp3", audioSource: "merriam-webster" },
    });
  });

  it("按钮上的来源说明覆盖每一种来源", () => {
    expect(pronunciationAudioLabel("youdao", "uk")).toBe("有道英式发音");
    expect(pronunciationAudioLabel("youdao", "us")).toBe("有道美式发音");
    expect(pronunciationAudioLabel("dictionary-api", "uk")).toBe("免费英式发音");
    expect(pronunciationAudioLabel("merriam-webster", "us")).toBe("韦氏美式发音");
    expect(pronunciationAudioLabel("system-tts", "uk")).toBe("系统英式发音");
  });

  it("牛津的美式音标只有半截时，用有道补一份完整的", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/local-dictionary")) return Promise.resolve({ ok: true, json: async () => ({
        oxfordPronunciation: { britishIpa: "/ˈɡʌvənmənt/", americanIpa: "/-vərn-/" },
      }) });
      if (url.startsWith("/api/youdao-ipa")) return Promise.resolve({ ok: true, json: async () => ({
        usphone: "ˈɡʌvərnmənt", ukphone: "ˈɡʌvənmənt",
      }) });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWordPronunciation("government")).resolves.toMatchObject({
      british: { ipa: "/ˈɡʌvənmənt/", ipaSource: "oxford" },
      /* 有道不带斜杠，服务会把斜杠补齐，和另外两份音标写法一致 */
      american: { ipa: "/ˈɡʌvərnmənt/", ipaSource: "youdao" },
    });
  });

  it("美式音标完整时不问有道，一次都不问", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/local-dictionary")) return Promise.resolve({ ok: true, json: async () => ({
        oxfordPronunciation: { britishIpa: "/ˈʃedjuːl/", americanIpa: "/ˈskedʒuːl/" },
      }) });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWordPronunciation("schedule")).resolves.toMatchObject({
      american: { ipa: "/ˈskedʒuːl/", ipaSource: "oxford" },
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/youdao-ipa"), expect.anything());
  });

  it("有道也拿不到时，退回英式那一份，不留空", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/local-dictionary")) return Promise.resolve({ ok: true, json: async () => ({
        oxfordPronunciation: { britishIpa: "/kənˈsɜːvətɪv/", americanIpa: "/-ˈsɜːrv-/" },
      }) });
      if (url.startsWith("/api/youdao-ipa")) return Promise.resolve({ ok: false, json: async () => ({}) });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    }));

    await expect(fetchWordPronunciation("conservative")).resolves.toMatchObject({
      american: { ipa: "/kənˈsɜːvətɪv/", ipaSource: "oxford" },
    });
  });
});

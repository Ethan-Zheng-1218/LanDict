import { afterEach, expect, it, vi } from "vitest";
import { createBrowserDictionaryApi, usesDesktopBackend } from "./dictionaryProvider";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<unknown>) {
  const fetchMock = vi.fn(handler);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("posts the whole batch word list in one request", async () => {
  const fetchMock = stubFetch(async () => ({ ok: true, json: async () => ({ hits: { cat: { oxford: { word: "cat" } } } }) }));
  const hits = await createBrowserDictionaryApi().lookupWords(["cat", "cats"]);
  expect(hits.cat.oxford?.word).toBe("cat");
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/dictionary-lookup",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ words: ["cat", "cats"] }) }),
  );
});

it("falls back to empty results when an endpoint fails", async () => {
  stubFetch(async () => ({ ok: false, json: async () => ({}) }));
  const api = createBrowserDictionaryApi();
  expect(await api.lookupWords(["cat"])).toEqual({});
  expect(await api.reverseLookup("猫")).toEqual([]);
  expect(await api.lookupLemmas(["ran"])).toEqual({});
});

it("posts the Chinese term to the reverse endpoint", async () => {
  const fetchMock = stubFetch(async () => ({ ok: true, json: async () => ({ hits: [{ word: "abandon", source: "cedict" }] }) }));
  const hits = await createBrowserDictionaryApi().reverseLookup("放弃");
  expect(hits[0].word).toBe("abandon");
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/dictionary-reverse",
    expect.objectContaining({ body: JSON.stringify({ term: "放弃" }) }),
  );
});

it("keeps reading phonetics from the existing local dictionary endpoint", async () => {
  const fetchMock = stubFetch(async () => ({
    ok: true,
    json: async () => ({
      britishPhonetic: "kæt",
      oxfordPronunciation: { britishIpa: "/kæt/", americanIpa: "/kæt/" },
      merriamWebster: { audioUrl: "https://example.test/cat.mp3" },
    }),
  }));
  const hint = await createBrowserDictionaryApi().lookupPronunciation("cat");
  expect(fetchMock).toHaveBeenCalledWith("/api/local-dictionary?word=cat", undefined);
  expect(hint).toEqual({
    britishIpa: "/kæt/",
    americanIpa: "/kæt/",
    americanAudioUrl: "https://example.test/cat.mp3",
    ecdictPhonetic: "kæt",
  });
});

it("prefers the Oxford IPA over the ECDICT phonetic, as before the migration", async () => {
  stubFetch(async () => ({
    ok: true,
    json: async () => ({ britishPhonetic: "kæt", oxfordPronunciation: { britishIpa: "/kæt/" } }),
  }));
  const hint = await createBrowserDictionaryApi().lookupPronunciation("cat");
  expect(hint.britishIpa).toBe("/kæt/");
  expect(hint.ecdictPhonetic).toBe("kæt");
});

it("does not use the desktop backend on the dev origin", () => {
  expect(usesDesktopBackend()).toBe(false);
});

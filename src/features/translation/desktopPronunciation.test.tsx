import { cleanup, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryPage } from "./QueryPage";
import { fetchIpaPronunciations, fetchLocalWordPronunciation, fetchWordPronunciation } from "./pronunciationService";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));

const entries = {
  cat: { word: "cat", phonetic: "kæt", translation: "n. 猫", definition: "n. a small animal", pos: "n", exchange: "s:cats" },
  food: { word: "food", phonetic: "fu:d", translation: "n. 食物", definition: "n. something to eat", pos: "n", exchange: "" },
};

beforeEach(() => {
  window.localStorage.clear();
  vi.resetAllMocks();
  vi.stubGlobal("window", Object.assign(Object.create(window), { location: new URL("http://tauri.localhost/") }));
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "desktop_dictionary") return { entry: entries[(args as { word: keyof typeof entries }).word] };
    if (command === "dictionary_lookup") return Object.fromEntries(
      (args as { words: string[] }).words.map(word => [word, { ecdict: entries[word as keyof typeof entries] }]),
    );
    throw new Error(`Unexpected command: ${command}`);
  });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each([
  ["cat", "/kæt/"],
  ["food", "/fu:d/"],
])("shows both local phonetics for %s in the installed query page while offline", async (word, ipa) => {
  render(<MemoryRouter initialEntries={[`/query?q=${word}`]}><QueryPage /></MemoryRouter>);
  expect(await screen.findByRole("button", { name: `英 ${ipa}` })).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: `美 ${ipa}` })).toBeInTheDocument();
  expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).startsWith("/api/"))).toBe(true);
});

it("returns native local phonetics before slow online requests finish", async () => {
  let resolveOnline!: (value: unknown) => void;
  vi.stubGlobal("fetch", vi.fn(async url => {
    if (String(url).includes("dictionaryapi.dev")) return new Promise(resolve => { resolveOnline = resolve; });
    return { ok: false };
  }));
  const update = vi.fn();
  const local = await fetchWordPronunciation("cat", undefined, update);
  expect(local.british.ipa).toBe("/kæt/");
  expect(local.american.ipa).toBe("/kæt/");
  resolveOnline({ ok: false });
});

it("keeps online accent-specific IPA and audio ahead of the native ECDICT fallback", async () => {
  vi.stubGlobal("fetch", vi.fn(async url => String(url).includes("dictionaryapi.dev") ? {
    ok: true, json: async () => [{ phonetics: [
      { text: "/online-gb/", audio: "https://audio.example/cat-uk.mp3" },
      { text: "/online-us/", audio: "https://audio.example/cat-us.mp3" },
    ] }],
  } : { ok: false }));
  expect(await fetchWordPronunciation("cat")).toMatchObject({
    // 音标仍以在线那份为准；英式音频用免费的，美式音频让位给覆盖更好的有道录音。
    british: { ipa: "/online-gb/", audioUrl: "https://audio.example/cat-uk.mp3" },
    american: { ipa: "/online-us/", audioUrl: "https://dict.youdao.com/dictvoice?audio=cat&type=2" },
  });
});

it("requests Wiktionary directly in the installed app without a dev server", async () => {
  vi.stubGlobal("fetch", vi.fn(async url => String(url).startsWith("https://en.wiktionary.org/w/api.php?") ? {
    ok: true, json: async () => ({ parse: { wikitext: { "*": "===Pronunciation===\n* {{IPA|en|/kæt/|a=RP,GA}}" } } }),
  } : { ok: false }));
  expect(await fetchIpaPronunciations("cat")).toEqual({ gbText: "/kæt/", usText: "/kæt/" });
});

it("keeps the HTTP local dictionary source in Tauri development mode", async () => {
  vi.stubGlobal("window", Object.assign(Object.create(window), { location: new URL("http://localhost:5173/") }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ oxfordPronunciation: { britishIpa: "/kæt/", americanIpa: "/kæt/" } }),
  }));
  expect(await fetchLocalWordPronunciation("cat")).toMatchObject({ britishPhonetic: "/kæt/", americanPhonetic: "/kæt/" });
  expect(invoke).not.toHaveBeenCalled();
});

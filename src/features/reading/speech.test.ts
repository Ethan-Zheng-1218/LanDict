import { describe, expect, it } from "vitest";

import { findWordBounds, pickVoiceFor } from "./speech";

type Voice = { name: string; lang: string; localService: boolean };

const voices: Voice[] = [
  { name: "Microsoft David - English (United States)", lang: "en-US", localService: true },
  { name: "Google UK English Female", lang: "en-GB", localService: false },
  { name: "Microsoft Libby Online (Natural) - English (United Kingdom)", lang: "en-GB", localService: false },
  { name: "Microsoft Aria Online (Natural) - English (United States)", lang: "en-US", localService: false },
];

describe("read-aloud voice selection", () => {
  it("prefers a neural voice of the requested accent", () => {
    expect(pickVoiceFor(voices as SpeechSynthesisVoice[], "en-GB")?.name).toBe("Microsoft Libby Online (Natural) - English (United Kingdom)");
    expect(pickVoiceFor(voices as SpeechSynthesisVoice[], "en-US")?.name).toBe("Microsoft Aria Online (Natural) - English (United States)");
  });

  it("falls back to a cloud voice before the old local one", () => {
    const withoutNeural = voices.filter((voice) => !/Natural/.test(voice.name));

    expect(pickVoiceFor(withoutNeural as SpeechSynthesisVoice[], "en-GB")?.name).toBe("Google UK English Female");
  });

  it("returns nothing when the accent has no voice at all", () => {
    expect(pickVoiceFor([{ name: "Google 普通话", lang: "zh-CN", localService: false }] as SpeechSynthesisVoice[], "en-US")).toBeUndefined();
  });
});

describe("spoken word bounds", () => {
  it("expands a partial offset to the whole word", () => {
    const text = "The UK's biggest broadband provider, BT, agreed.";

    expect(findWordBounds(text, 30, 0)).toEqual({ start: 27, end: 35 });
    expect(text.slice(27, 35)).toBe("provider");
    expect(findWordBounds(text, 22, 0)).toEqual({ start: 17, end: 26 });
    expect(text.slice(17, 26)).toBe("broadband");
  });

  it("keeps apostrophes inside the word", () => {
    const text = "The UK's biggest provider";

    expect(findWordBounds(text, 5, 3)).toEqual({ start: 4, end: 8 });
    expect(text.slice(4, 8)).toBe("UK's");
  });

  it("ignores punctuation-only positions", () => {
    expect(findWordBounds("hello, world", 5, 0)).toBeNull();
  });
});

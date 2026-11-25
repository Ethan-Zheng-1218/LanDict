import { describe, expect, it } from "vitest";

import { getMerriamWebsterAudioUrl, queryMerriamWebsterPronunciation } from "./merriamWebster";

describe("Merriam-Webster pronunciation lookup", () => {
  it.each([
    ["water", "water002"],
    ["student", "studen01"],
    ["record", "record01"],
    ["dictionary", "dictio04"],
    ["schedule", "schedu01"],
  ])("reads the local pronunciation and audio id for %s", (word, audioId) => {
    const result = queryMerriamWebsterPronunciation(word);

    expect(result.pronunciation).not.toBe("");
    expect(result.audioId).toBe(audioId);
    expect(getMerriamWebsterAudioUrl(result.audioId)).toMatch(/^https:\/\/media\.merriam-webster\.com\/audio\/prons\/en\/us\/mp3\//);
  });

  it("keeps the primary American respelling before alternate variants", () => {
    expect(queryMerriamWebsterPronunciation("schedule").pronunciation).toBe("/ˈske-(ˌ)jül/");
  });

  it("uses Merriam-Webster's special audio directories", () => {
    expect(getMerriamWebsterAudioUrl("water002")).toBe("https://media.merriam-webster.com/audio/prons/en/us/mp3/w/water002.mp3");
    expect(getMerriamWebsterAudioUrl("bixby01")).toBe("https://media.merriam-webster.com/audio/prons/en/us/mp3/bix/bixby01.mp3");
    expect(getMerriamWebsterAudioUrl("3dprint01")).toBe("https://media.merriam-webster.com/audio/prons/en/us/mp3/number/3dprint01.mp3");
  });
});

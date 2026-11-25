import { describe, expect, it } from "vitest";

import { formatSourceKicker, getSectionLabel } from "./sourceLabel";

describe("reading source labels", () => {
  it("prints the BBC source once when the feed supplies no real section", () => {
    // The BBC top-news RSS has no <category>, so the parser falls back to "BBC News",
    // which used to render as "BBC News · BBC News".
    expect(formatSourceKicker("bbc", "BBC News")).toBe("BBC News");
    expect(formatSourceKicker("bbc", "bbc news")).toBe("BBC News");
    expect(formatSourceKicker("bbc", "News")).toBe("BBC News");
    expect(formatSourceKicker("bbc", "")).toBe("BBC News");
    expect(formatSourceKicker("bbc", "   ")).toBe("BBC News");
    expect(formatSourceKicker("bbc", undefined)).toBe("BBC News");
  });

  it("keeps a real feed section next to the source name", () => {
    expect(formatSourceKicker("bbc", "World")).toBe("BBC News · World");
    expect(formatSourceKicker("bbc", "  Climate  ")).toBe("BBC News · Climate");
  });

  it("labels the three additional external sources", () => {
    expect(formatSourceKicker("cgtn", "World")).toBe("CGTN · World");
    expect(formatSourceKicker("voa", "VOA News")).toBe("VOA");
    expect(formatSourceKicker("un-news", "Climate")).toBe("UN News · Climate");
  });

  it("never repeats the bundled source name", () => {
    expect(formatSourceKicker("bundled", "Climate")).toBe("Daily English · Climate");
    expect(formatSourceKicker("bundled", "Daily English")).toBe("Daily English");
    expect(formatSourceKicker("bundled", undefined)).toBe("Daily English");
  });

  it("drops generic section labels", () => {
    expect(getSectionLabel("BBC News", "bbc")).toBe("");
    expect(getSectionLabel("Top Stories", "bbc")).toBe("");
    expect(getSectionLabel("General News", "bbc")).toBe("");
    expect(getSectionLabel("Science", "bbc")).toBe("Science");
    expect(getSectionLabel(undefined, "bundled")).toBe("");
  });
});

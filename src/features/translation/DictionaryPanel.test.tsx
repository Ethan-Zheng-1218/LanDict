import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DictionaryPanel } from "./DictionaryPanel";

const entry = {
  phonetic: "/ˌserənˈdɪpəti/",
  word: "serendipity",
  britishPhonetic: "/ˌserənˈdɪpəti/",
  americanPhonetic: "/ˌserənˈdɪpəti/",
  partOfSpeech: "noun",
  meaning: "意外发现美好事物的运气",
  definition: "the occurrence of events by chance in a happy way",
  example: "A fortunate stroke of serendipity.",
  collocations: ["a moment of serendipity", "pure serendipity", "by serendipity"],
  examples: [{ partOfSpeech: "noun", text: "A fortunate stroke of serendipity." }],
  exchange: ["复数 serendipities"],
  meanings: [{ partOfSpeech: "noun", translations: ["意外发现美好事物的运气"] }],
  definitions: ["the occurrence of events by chance in a happy way"],
  wordForms: [{ label: "复数", value: "serendipities" }],
  source: "ECDICT" as const,
};

describe("DictionaryPanel", () => {
  it("places examples before the adjacent collocations and word forms", () => {
    render(<DictionaryPanel entry={entry} />);
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["常见例句", "常见搭配", "词形变化"]);
  });
  it("shows structured learning sections", () => {
    render(<DictionaryPanel entry={entry} />);

    expect(screen.getByTestId("dictionary-entry")).toBeInTheDocument();
    expect(screen.getByText("意外发现美好事物的运气")).toBeInTheDocument();
    expect(screen.queryByText("英文解释")).not.toBeInTheDocument();
    expect(screen.getByText("常见搭配")).toBeInTheDocument();
    expect(screen.getByText("常见例句")).toBeInTheDocument();
    expect(screen.getByText("a moment of serendipity")).toBeInTheDocument();
    expect(screen.getByText("A fortunate stroke of serendipity.")).toBeInTheDocument();
    expect(screen.getByText("词形变化")).toBeInTheDocument();
    expect(screen.getByText("复数 serendipities")).toBeInTheDocument();
  });

  it("shows friendly placeholders when optional fields are empty", () => {
    render(<DictionaryPanel entry={{ ...entry, collocations: [], examples: [], exchange: [], wordForms: [] }} />);

    expect(screen.getByText("暂无常见搭配")).toBeInTheDocument();
    expect(screen.getByText("暂无常见例句")).toBeInTheDocument();
    expect(screen.queryByText("词形变化")).not.toBeInTheDocument();
  });

  it("always places a Chinese example translation below its English sentence", () => {
    render(<DictionaryPanel entry={{
      ...entry,
      examples: [{ partOfSpeech: "noun", text: "A fortunate stroke of serendipity.", translation: "幸运地偶然发现美好事物。" }],
    }} />);

    expect(screen.getByText("幸运地偶然发现美好事物。").closest("p")).toHaveClass("always-stacked");
  });

  it("supports a compact reverse-lookup view without unrelated learning sections", () => {
    render(<DictionaryPanel entry={entry} compact />);

    expect(screen.getByText("serendipity")).toBeInTheDocument();
    expect(screen.getByText("意外发现美好事物的运气")).toBeInTheDocument();
    expect(screen.queryByText("常见搭配")).not.toBeInTheDocument();
    expect(screen.queryByText("常见例句")).not.toBeInTheDocument();
    expect(screen.queryByText("词形变化")).not.toBeInTheDocument();
  });
});

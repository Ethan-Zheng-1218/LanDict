import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { addLearningEvent } from "./learningStore";
import { LearningHistory } from "./LearningHistory";

describe("LearningHistory", () => {
  beforeEach(() => window.localStorage.clear());

  it("shows recent learning events", () => {
    addLearningEvent({ type: "reading", label: "Global Push for Clean Energy Gains Momentum" });

    render(<LearningHistory />);

    expect(screen.getByTestId("learning-history")).toHaveTextContent("Global Push for Clean Energy Gains Momentum");
  });

  it("shows an empty state", () => {
    render(<LearningHistory />);

    expect(screen.getByTestId("learning-history")).toHaveTextContent("还没有学习记录");
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LookupText } from "./LookupText";

afterEach(() => vi.restoreAllMocks());
it("preserves visible text and passes the clicked spelling without punctuation or lemmatization", () => {
  const onLookup = vi.fn();
  const sentence = "He had been dogged by bad health all his life.";
  const view = render(<p><LookupText text={sentence} onLookup={onLookup} /></p>);
  expect(view.container.textContent).toBe(sentence);
  fireEvent.click(screen.getByRole("button", { name: "查词 dogged" }));
  expect(onLookup).toHaveBeenCalledWith("dogged");
  fireEvent.click(screen.getByRole("button", { name: "查词 health" }));
  expect(onLookup).toHaveBeenLastCalledWith("health");
  expect(screen.queryByRole("button", { name: "查词 ." })).not.toBeInTheDocument();
});
it("ignores drag selection and existing text selections", () => {
  const onLookup = vi.fn();
  render(<LookupText text="bad health" onLookup={onLookup} />);
  const word = screen.getByRole("button", { name: "查词 health" });
  fireEvent.mouseDown(word, { clientX: 10, clientY: 10 });
  fireEvent.mouseUp(word, { clientX: 80, clientY: 10 });
  fireEvent.click(word);
  expect(onLookup).not.toHaveBeenCalled();
  fireEvent.mouseDown(word, { clientX: 10, clientY: 10 });
  vi.spyOn(window, "getSelection").mockReturnValue({ isCollapsed: false } as Selection);
  fireEvent.click(word);
  expect(onLookup).not.toHaveBeenCalled();
});

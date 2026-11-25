import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssistedWordInput } from "./AssistedWordInput";
import { getDefinitionPreview } from "./definitionPreview";
import { getInputCompletion } from "./inputCompletion";

vi.mock("./definitionPreview", () => ({ getDefinitionPreview: vi.fn() }));
vi.mock("./inputCompletion", () => ({ getInputCompletion: vi.fn() }));
function Harness({ submitted = vi.fn() }: { submitted?: (word: string) => void }) {
  const [value, setValue] = useState("CAPT");
  return <form onSubmit={event => { event.preventDefault(); submitted(value); }}><AssistedWordInput as="input" label="word" value={value} onChange={setValue} placeholder="word" /><button>查询</button></form>;
}
beforeEach(() => { vi.useFakeTimers(); vi.mocked(getDefinitionPreview).mockResolvedValue(""); vi.mocked(getInputCompletion).mockResolvedValue("CAPTURE"); });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it("shows ghost letters separately and accepts them with Tab without submitting", async () => {
  const submitted = vi.fn();
  render(<Harness submitted={submitted} />);
  const input = screen.getByLabelText("word");
  fireEvent.focus(input);
  await act(async () => { await vi.advanceTimersByTimeAsync(180); });
  expect(input).toHaveValue("CAPT");
  expect(screen.getByTestId("word-completion")).toHaveTextContent("CAPTURE");
  expect(screen.getByTestId("word-completion")).toHaveAttribute("aria-hidden", "true");
  fireEvent.keyDown(input, { key: "Tab" });
  expect(input).toHaveValue("CAPTURE");
  expect(submitted).not.toHaveBeenCalled();
});
it("hides the ghost on Escape or a middle caret, and never accepts it during IME", async () => {
  render(<Harness />);
  const input = screen.getByLabelText("word") as HTMLInputElement;
  fireEvent.focus(input);
  await act(async () => { await vi.advanceTimersByTimeAsync(180); });
  input.setSelectionRange(1, 1);
  fireEvent.select(input);
  expect(screen.queryByTestId("word-completion")).not.toBeInTheDocument();
  input.setSelectionRange(4, 4);
  fireEvent.select(input);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByTestId("word-completion")).not.toBeInTheDocument();
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Tab" });
  expect(input).toHaveValue("CAPT");
});

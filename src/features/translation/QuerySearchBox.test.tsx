import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuerySearchBox } from "./QuerySearchBox";
import { getDefinitionPreview } from "./definitionPreview";
import { getInputCompletion } from "./inputCompletion";
import { addHistory, listHistory } from "../history/historyStore";

vi.mock("./definitionPreview", () => ({ getDefinitionPreview: vi.fn() }));
vi.mock("./inputCompletion", () => ({ getInputCompletion: vi.fn() }));
function Harness({ onSearch = vi.fn() }: { onSearch?: (value: string) => void }) {
  const [value, setValue] = useState("dog");
  return <QuerySearchBox value={value} activeQuery="dog" onChange={setValue} onSearch={onSearch} />;
}
beforeEach(() => { window.localStorage.clear(); vi.mocked(getDefinitionPreview).mockReset().mockResolvedValue(""); vi.mocked(getInputCompletion).mockReset().mockResolvedValue(""); });
afterEach(() => { vi.useRealTimers(); });

it("ignores stale previews and never writes partial input to history", async () => {
  vi.useFakeTimers();
  let finishCat!: (value: string) => void;
  vi.mocked(getDefinitionPreview).mockImplementation(word => word === "cat" ? new Promise(resolve => { finishCat = resolve; }) : Promise.resolve(""));
  render(<Harness />);
  const input = screen.getByLabelText("重新查询");
  fireEvent.change(input, { target: { value: "cat" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(180); });
  fireEvent.change(input, { target: { value: "category" } });
  await act(async () => { finishCat("n. 猫"); await vi.advanceTimersByTimeAsync(180); });
  expect(screen.queryByTestId("definition-preview")).not.toBeInTheDocument();
  expect(input).toHaveValue("category");
  expect(listHistory()).toEqual([]);
});

it("shows a non-editable preview while keeping the submitted input unchanged", async () => {
  vi.useFakeTimers();
  vi.mocked(getDefinitionPreview).mockResolvedValue("n. 狗；v. 困扰");
  const onSearch = vi.fn();
  render(<Harness onSearch={onSearch} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(180); });
  expect(screen.getByTestId("definition-preview")).toHaveTextContent("n. 狗；v. 困扰");
  expect(screen.getByTestId("definition-preview")).toHaveAttribute("aria-hidden", "true");
  fireEvent.keyDown(screen.getByLabelText("重新查询"), { key: "Enter" });
  expect(onSearch).toHaveBeenCalledOnce();
  expect(onSearch).toHaveBeenCalledWith("dog");
  expect(screen.getByLabelText("重新查询")).toHaveValue("dog");
});

it("opens only the latest five records, queries a record, and closes on typing, Escape and outside clicks", async () => {
  for (let index = 0; index < 10; index++) addHistory({ query: `word${index}`, kind: "word", source: "test" });
  addHistory({ query: "break", kind: "word", source: "test" });
  const onSearch = vi.fn();
  render(<Harness onSearch={onSearch} />);
  const input = screen.getByLabelText("重新查询");
  fireEvent.focus(input);
  const history = await screen.findByRole("dialog", { name: "最近查询" });
  expect(within(history).getAllByRole("button").map(button => button.textContent)).toEqual(["break", "word9", "word8", "word7", "word6"]);
  fireEvent.click(within(history).getByRole("button", { name: "break" }));
  expect(onSearch).toHaveBeenCalledWith("break");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(input);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(input);
  await screen.findByRole("dialog", { name: "最近查询" });
  fireEvent.mouseDown(document.body);
  fireEvent.click(document.body);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(input);
  fireEvent.change(input, { target: { value: "do" } });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(input);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("uses the same submit callback for Enter and the button, suppressing IME and empty submissions", () => {
  const onSearch = vi.fn();
  render(<Harness onSearch={onSearch} />);
  const input = screen.getByLabelText("重新查询");
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.click(screen.getByRole("button", { name: "查询" }));
  expect(onSearch).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
  expect(onSearch).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.click(screen.getByRole("button", { name: "查询" }));
  expect(onSearch.mock.calls).toEqual([["dog"], ["dog"]]);
  fireEvent.change(input, { target: { value: "   " } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onSearch).toHaveBeenCalledTimes(2);
});

it("keeps Enter for multiline text and submits it only with Ctrl+Enter", () => {
  const onSearch = vi.fn();
  render(<Harness onSearch={onSearch} />);
  const input = screen.getByLabelText("重新查询");
  fireEvent.change(input, { target: { value: "line one\nline two" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onSearch).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  expect(onSearch).toHaveBeenCalledWith("line one\nline two");
});

it("Enter searches actual input even when a grey completion is visible", async () => {
  vi.useFakeTimers();
  vi.mocked(getInputCompletion).mockResolvedValue("CAPTURE");
  const onSearch = vi.fn();
  render(<Harness onSearch={onSearch} />);
  const input = screen.getByLabelText("重新查询");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "CAPT" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(180); });
  expect(screen.getByTestId("word-completion")).toBeInTheDocument();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onSearch).toHaveBeenCalledWith("CAPT");
  expect(input).toHaveValue("CAPT");
});

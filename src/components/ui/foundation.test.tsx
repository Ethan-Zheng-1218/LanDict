import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IconButton } from "./icon-button";
import { SearchBox } from "./search-box";
import { PageHeader } from "./page-header";
import { Button } from "./button";
import { Input } from "./input";
import { Search } from "./icon";

describe("shared foundation controls", () => {
  it("forwards icon button names, references and actions", () => {
    const onClick = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(<IconButton label="播放发音" ref={ref} onClick={onClick}><Search /></IconButton>);
    fireEvent.click(screen.getByRole("button", { name: "播放发音" }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(ref.current).toBe(screen.getByRole("button", { name: "播放发音" }));
  });
  it("blocks a loading action without losing its accessible label", () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>测试连接</Button>);
    const button = screen.getByRole("button", { name: "测试连接" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
  it("preserves form submission and a controlled search input", () => {
    const submit = vi.fn((event) => event.preventDefault());
    render(<SearchBox aria-label="查询" onSubmit={submit}><Input aria-label="查询内容" defaultValue="cat" /><Button type="submit">查询</Button></SearchBox>);
    expect(screen.getByRole("textbox", { name: "查询内容" })).toHaveValue("cat");
    fireEvent.submit(screen.getByRole("form", { name: "查询" }));
    expect(submit).toHaveBeenCalledOnce();
  });
  it("keeps link navigation and heading semantics in composed controls", () => {
    render(<PageHeader title="cat" headingLevel={2} actions={<IconButton label="查看历史记录" nativeButton={false} render={<a href="/records" />}><Search /></IconButton>} />);
    expect(screen.getByRole("heading", { name: "cat", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看历史记录" })).toHaveAttribute("href", "/records");
  });
});

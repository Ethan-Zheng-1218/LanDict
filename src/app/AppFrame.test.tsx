import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import { updateReadingProgress, READING_ARTICLE_ID } from "@/features/reading/readingStore";

import { QueryPage } from "../features/translation/QueryPage";

import { AppFrame } from "./AppFrame";
import { saveSettings } from "@/features/settings/settingsStore";

function ReadingNavigationProbe() {
  const location = useLocation();
  return <>
    <output data-testid="reading-location">{location.pathname}{location.search}</output>
    <output data-testid="reading-state">{JSON.stringify(location.state)}</output>
    {location.pathname.startsWith("/reading") && <section data-testid="reading-scroll" className={location.pathname === "/reading" ? "reading-home-page" : "reading-article-scroll"}>阅读内容</section>}
    <Link to="/reading?view=news">选择新闻</Link>
  </>;
}

describe("AppFrame", () => {
  beforeEach(() => window.localStorage.clear());

  it("restores the global theme and applies changes from settings immediately", () => {
    saveSettings({ appearance: { theme: "black" } });
    render(<MemoryRouter><AppFrame><p>主页内容</p></AppFrame></MemoryRouter>);
    expect(document.documentElement).toHaveAttribute("data-theme", "black");

    fireEvent.click(screen.getByRole("link", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: "主题" }));
    fireEvent.click(screen.getByRole("radio", { name: "轻盈绿" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "lime");
    fireEvent.click(screen.getByRole("button", { name: "关闭设置" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "lime");
    expect(screen.getByRole("main")).toHaveTextContent("主页内容");
  });

  it("updates the global theme when settings change in another window", () => {
    render(<MemoryRouter><AppFrame><p>主页内容</p></AppFrame></MemoryRouter>);
    window.localStorage.setItem("landict.settings", JSON.stringify({ version: 1, data: { appearance: { theme: "black" } } }));
    fireEvent(window, new StorageEvent("storage", { key: "landict.settings" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "black");
  });

  it("opens recommendations on the first reading visit", () => {
    render(<MemoryRouter initialEntries={["/query"]}><AppFrame><ReadingNavigationProbe /></AppFrame></MemoryRouter>);
    fireEvent.click(screen.getByRole("link", { name: "阅读" }));
    expect(screen.getByTestId("reading-location").textContent).toBe("/reading");
  });

  it("resumes the reading tab and its scroll position after visiting translation", () => {
    render(<MemoryRouter initialEntries={["/reading?view=news"]}><AppFrame><ReadingNavigationProbe /></AppFrame></MemoryRouter>);
    fireEvent.scroll(screen.getByTestId("reading-scroll"), { target: { scrollTop: 317 } });
    fireEvent.click(screen.getByRole("link", { name: "翻译" }));
    fireEvent.click(screen.getByRole("link", { name: "阅读" }));
    expect(screen.getByTestId("reading-location")).toHaveTextContent("/reading?view=news");
    expect(JSON.parse(screen.getByTestId("reading-state").textContent!)).toMatchObject({ readingScrollTop: 317 });
  });

  it("keeps the unfinished article and its return destination across frame remounts", () => {
    const initial = { pathname: "/reading/article", search: "?id=sample", state: { returnTo: { pathname: "/reading", search: "?view=articles" } } };
    const first = render(<MemoryRouter initialEntries={[initial]}><AppFrame><ReadingNavigationProbe /></AppFrame></MemoryRouter>);
    fireEvent.scroll(screen.getByTestId("reading-scroll"), { target: { scrollTop: 483 } });
    fireEvent.click(screen.getByRole("link", { name: "翻译" }));
    first.unmount();
    render(<MemoryRouter initialEntries={["/query"]}><AppFrame><ReadingNavigationProbe /></AppFrame></MemoryRouter>);
    fireEvent.click(screen.getByRole("link", { name: "阅读" }));
    expect(screen.getByTestId("reading-location")).toHaveTextContent("/reading/article?id=sample");
    expect(JSON.parse(screen.getByTestId("reading-state").textContent!)).toMatchObject({ readingScrollTop: 483, returnTo: initial.state.returnTo });
  });

  it("uses an existing unfinished reading record when there is no saved navigation position", () => {
    updateReadingProgress(READING_ARTICLE_ID, 30, "已有文章");
    render(<MemoryRouter initialEntries={["/query"]}><AppFrame><ReadingNavigationProbe /></AppFrame></MemoryRouter>);
    fireEvent.click(screen.getByRole("link", { name: "阅读" }));
    expect(screen.getByTestId("reading-location")).toHaveTextContent(`/reading/article?id=${READING_ARTICLE_ID}`);
  });
  it("renders LanDict navigation and the main content outlet", () => {
    render(
      <MemoryRouter>
        <AppFrame>
          <p>主页内容</p>
        </AppFrame>
      </MemoryRouter>,
    );

    expect(screen.getByText("LanDict")).toBeInTheDocument();
    expect(screen.getByText("Less is more")).toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "主导航" });
    ["首页", "翻译", "阅读", "生词本", "背单词"].forEach((label) => {
      expect(navigation).toHaveTextContent(label);
    });
    expect(navigation).not.toHaveTextContent("AI学习");
    expect(screen.getByRole("main")).toHaveTextContent("主页内容");
    expect(screen.getByRole("main")).toHaveAttribute("data-scroll-container", "app-content");
    expect(screen.getByTestId("sidebar-settings")).toBeInTheDocument();
    expect(document.querySelector(".app-sidebar-provider")).toHaveStyle({ "--sidebar-width": "var(--app-sidebar-width)" });
  });

  it("provides a dedicated sidebar area for an article outline", () => {
    render(
      <MemoryRouter initialEntries={["/reading/article?id=sample"]}>
        <AppFrame><p>阅读内容</p></AppFrame>
      </MemoryRouter>,
    );

    expect(document.querySelector("#reading-outline-sidebar-slot")).toBeInTheDocument();
  });

  it("marks translation as active without marking home active", () => {
    render(
      <MemoryRouter initialEntries={["/query?q=cat"]}>
        <AppFrame><p>翻译内容</p></AppFrame>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "翻译" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "首页" })).not.toHaveAttribute("aria-current");
  });

  it("leaves window controls to the native Windows titlebar", () => {
    render(
      <MemoryRouter initialEntries={["/query?q=dock"]}>
        <AppFrame><QueryPage /></AppFrame>
      </MemoryRouter>,
    );

    expect(document.querySelector("header[data-tauri-drag-region]")).toBeNull();
    expect(screen.queryByRole("button", { name: "最大化" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "最小化" })).not.toBeInTheDocument();
  });

  it("keeps the previous query editable while preserving the input placeholder", () => {
    render(
      <MemoryRouter initialEntries={["/query?q=previous%20query"]}>
        <AppFrame><QueryPage /></AppFrame>
      </MemoryRouter>,
    );

    const input = screen.getByRole("textbox", { name: "重新查询" });
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveValue("previous query");
    expect(input).toHaveAttribute("placeholder", "输入单词、短语或句子");
    fireEvent.change(input, { target: { value: "new query" } });
    expect(input).toHaveValue("new query");
    expect(input).toHaveAttribute("placeholder", "输入单词、短语或句子");
  });

  it("keeps settings available on the query route", () => {
    render(
      <MemoryRouter initialEntries={["/query?q=serendipity"]}>
        <AppFrame>
          <p>查询内容</p>
        </AppFrame>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("sidebar-settings")).toBeVisible();
    expect(screen.getByRole("link", { name: "设置" })).toBeVisible();
  });

  it("opens settings as an overlay without replacing the background page", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppFrame><p>首页原位置</p></AppFrame>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("link", { name: "设置" }));

    expect(screen.getByRole("main")).toHaveTextContent("首页原位置");
    expect(screen.getByRole("dialog", { name: "设置" })).toBeVisible();
  });

  it("keeps the home titlebar free of decorative quotes", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppFrame><p>主页内容</p></AppFrame>
      </MemoryRouter>,
    );

    expect(screen.queryByText("“The limits of my language mean the limits of my world.”")).not.toBeInTheDocument();
    expect(screen.queryByText("语言的边界，就是我世界的边界。")).not.toBeInTheDocument();
  });

  it("keeps the vocabulary titlebar free of decorative quotes", () => {
    render(
      <MemoryRouter initialEntries={["/vocabulary"]}>
        <AppFrame><p>生词本内容</p></AppFrame>
      </MemoryRouter>,
    );

    expect(screen.queryByText("“The limits of my language mean the limits of my world.”")).not.toBeInTheDocument();
  });
});

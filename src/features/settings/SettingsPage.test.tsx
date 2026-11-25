import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsPage } from "./SettingsPage";
import { loadSettings } from "./settingsStore";

describe("SettingsPage", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("saves hover lookup preferences and the configurable delay", () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("鼠标停留时间"), { target: { value: "800" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "鼠标取词" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "本地 OCR 补充" }));
    expect(loadSettings().mouseLookup).toEqual({ enabled: false, delayMs: 800, ocrEnabled: false });
  });

  it("allows clearing the delay field before typing a new value", () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    const delay = screen.getByLabelText("鼠标停留时间");
    fireEvent.change(delay, { target: { value: "" } });
    expect(delay).toHaveValue(null);
    expect(loadSettings().mouseLookup.delayMs).toBe(500);
    fireEvent.change(delay, { target: { value: "750" } });
    expect(loadSettings().mouseLookup.delayMs).toBe(750);
  });

  it("shows the four settings sections and starts on general", () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "通用" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "主题" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "翻译" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关于" })).toBeInTheDocument();
    expect(screen.queryByText("默认语言")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("单词自动查询")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("AI 自动翻译")).not.toBeInTheDocument();
    expect(screen.queryByText("本地数据")).not.toBeInTheDocument();
    expect(screen.queryByText(/取词后的 AI 语境义/)).not.toBeInTheDocument();
  });

  it("credits every dictionary data source in the about section", () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "关于" }));

    // CC-CEDICT 的 CC BY-SA 4.0 要求署名，这一行就是署名位置。
    expect(screen.getByText("词典数据")).toBeInTheDocument();
    expect(screen.getByText(/CC-CEDICT（CC BY-SA 4.0）/)).toBeInTheDocument();
    expect(screen.getByText(/ECDICT 兜底词库为 MIT 许可/)).toBeInTheDocument();
    expect(screen.queryByText("本地翻译模型")).not.toBeInTheDocument();
  });

  it("lets the reader choose the read-aloud accent", () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    expect(screen.getByText("朗读口音")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "美式发音" }));

    expect(loadSettings().reading.voiceAccent).toBe("en-US");
  });

  it("fills the endpoint and model automatically for a known provider", () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "翻译" }));
    expect(screen.queryByLabelText("启用翻译引擎")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("服务类型"), { target: { value: "deepseek" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "secret" } });

    // Filling the key is the only switch: the header shows the engine is ready to use.
    expect(screen.getByText("可用")).toBeInTheDocument();

    // DeepSeek knows its own endpoint and model, so those fields are not shown at all.
    expect(screen.queryByLabelText("API Base URL")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("模型名称")).not.toBeInTheDocument();
    expect(screen.getByText("https://api.deepseek.com/v1 · deepseek-chat")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    expect(loadSettings().translation).toMatchObject({ provider: "deepseek", apiBaseUrl: "https://api.deepseek.com/v1", apiKey: "secret", model: "deepseek-chat" });
    expect(screen.getByText("配置已保存")).toBeInTheDocument();
  });

  it("repairs a stale saved endpoint when the settings page opens", () => {
    window.localStorage.setItem("landict.settings", JSON.stringify({ version: 1, data: {
      translation: { enabled: true, provider: "deepseek", apiBaseUrl: "https://platform.deepseek.com/api_keys", apiKey: "secret", model: "deepseek" },
    } }));

    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "翻译" }));

    expect(screen.getByText("https://api.deepseek.com/v1 · deepseek-chat")).toBeInTheDocument();
    expect(screen.queryByText(/platform\.deepseek\.com\/api_keys/)).not.toBeInTheDocument();
  });

  it("keeps the manual fields for a custom OpenAI-compatible endpoint", () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "翻译" }));
    fireEvent.change(screen.getByLabelText("服务类型"), { target: { value: "openai-compatible" } });
    fireEvent.change(screen.getByLabelText("API Base URL"), { target: { value: "https://api.example.com/v1" } });
    fireEvent.change(screen.getByLabelText("模型名称"), { target: { value: "demo-model" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    expect(loadSettings().translation).toMatchObject({ provider: "openai-compatible", apiBaseUrl: "https://api.example.com/v1", apiKey: "secret", model: "demo-model" });
  });

  it("reports both success and failure from the connection test", async () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "翻译" }));
    fireEvent.change(screen.getByLabelText("服务类型"), { target: { value: "deepseek" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "secret" } });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 401, statusText: "Unauthorized",
      text: async () => JSON.stringify({ error: { message: "Authentication Fails" } }),
    }));
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    expect(await screen.findByText(/401/)).toBeInTheDocument();
    expect(await screen.findByText(/Authentication Fails/)).toBeInTheDocument();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: "OK",
      text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
    }));
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    expect(await screen.findByText(/连接成功/)).toBeInTheDocument();
  });

  it("keeps pronunciation provider settings out of the translation page", () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "翻译" }));
    expect(screen.queryByText("发音服务")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("发音服务 App ID")).not.toBeInTheDocument();
  });

  it("keeps the automatic lookup switches above the API configuration on translation", () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "翻译" }));

    const toggle = screen.getByLabelText("单词自动查询") as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    fireEvent.click(toggle);

    expect(toggle.checked).toBe(false);
    expect(loadSettings().reading.autoLookupWord).toBe(false);
    const aiToggle = screen.getByRole("checkbox", { name: "AI 自动翻译" });
    expect(aiToggle).not.toBeChecked();
    fireEvent.click(aiToggle);
    expect(loadSettings().query.aiEnabled).toBe(true);
    fireEvent.click(aiToggle);
    expect(loadSettings().query.aiEnabled).toBe(false);
    expect(screen.getByText("本地翻译")).toBeInTheDocument();
    expect(screen.getByText("AI 翻译")).toBeInTheDocument();
    expect(screen.queryByText("AI 翻译（可选）")).not.toBeInTheDocument();
    const engine = screen.getByText("AI 翻译服务");
    expect(toggle.compareDocumentPosition(engine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(["通用", "翻译", "关于"])("keeps the %s section heading free of introductory descriptions", (section) => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: section }));

    const heading = screen.getByRole("heading", { name: section });
    expect(heading).toBeInTheDocument();
    expect(heading.closest("header")?.querySelector("p")).toBeNull();
  });

  it("keeps a stable window while switching sections", () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    const window = screen.getByTestId("settings-window");
    fireEvent.click(screen.getByRole("button", { name: "翻译" }));
    expect(screen.getByTestId("settings-window")).toBe(window);
    expect(screen.getByTestId("settings-content")).toBeInTheDocument();
  });

  it("offers three themes and restores the selection when settings reopen", () => {
    const first = render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: "主题" }));
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "晴空蓝" })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: "轻盈绿" }));
    expect(loadSettings()).toMatchObject({ appearance: { theme: "lime" } });
    first.unmount();

    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: "主题" }));
    expect(screen.getByRole("radio", { name: "轻盈绿" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "慕夜黑" }));
    expect(loadSettings()).toMatchObject({ appearance: { theme: "black" } });
  });
});

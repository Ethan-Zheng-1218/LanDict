import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";

const system = vi.hoisted(() => ({ desktop: true, enabled: false, failWrite: false, failRead: false }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => system.desktop }));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: async () => { if (system.failRead) throw new Error("读取失败"); return system.enabled; },
  enable: async () => { if (system.failWrite) throw new Error("写入失败"); system.enabled = true; },
  disable: async () => { if (system.failWrite) throw new Error("写入失败"); system.enabled = false; },
}));

describe("general Windows autostart setting", () => {
  beforeEach(() => {
    Object.assign(system, { desktop: true, enabled: false, failWrite: false, failRead: false });
    window.localStorage.clear();
  });

  it("reads an installer-enabled system entry and lets the user disable and enable it", async () => {
    system.enabled = true;
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    const toggle = await screen.findByRole("checkbox", { name: "开机自启" });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("keeps the real state when changing the system entry fails", async () => {
    system.failWrite = true;
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    const toggle = await screen.findByRole("checkbox", { name: "开机自启" });
    await waitFor(() => expect(toggle).toBeEnabled());
    fireEvent.click(toggle);
    expect(await screen.findByRole("alert")).toHaveTextContent("写入失败");
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeEnabled();
  });

  it("shows a read error and allows retrying instead of pretending it is disabled", async () => {
    system.failRead = true;
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("读取失败");
    expect(screen.getByRole("checkbox", { name: "开机自启" })).toBeDisabled();
    system.failRead = false;
    system.enabled = true;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "开机自启" })).toBeChecked());
  });

  it("keeps the option unavailable in the browser edition", () => {
    system.desktop = false;
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    expect(screen.getByRole("checkbox", { name: "开机自启" })).toBeDisabled();
    expect(screen.getByText("仅 Windows 桌面版可设置")).toBeInTheDocument();
  });
});

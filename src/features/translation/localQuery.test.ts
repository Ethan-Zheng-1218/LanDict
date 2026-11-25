import { afterEach, describe, expect, it, vi } from "vitest";
import { getQueryResult, mergeAiPanels, resolveQuery } from "./translationService";
import { translateLocally } from "./localTranslationProvider";

vi.mock("./localTranslationProvider", () => ({ translateLocally: vi.fn(async () => ({ translation: "逐步淘汰", source: "en", target: "zh" })) }));
afterEach(() => vi.clearAllMocks());

describe("free default query", () => {
  it("shows local translation first and keeps AI as a separate placeholder", async () => {
    const result = await resolveQuery("We will phase it out.");
    expect(result.status).toBe("success");
    expect(result.panels[0]).toMatchObject({ id: "local", label: "本地翻译", body: "逐步淘汰" });
    expect(result.panels.find(p => p.id === "ai")?.badge).toBe("点击展开");
  });
  it("keeps local errors local without a paid fallback", async () => {
    vi.mocked(translateLocally).mockRejectedValueOnce(new Error("模型缺失"));
    const fetch = vi.spyOn(globalThis, "fetch");
    const result = await resolveQuery("We will phase it out.");
    expect(result.status).toBe("error");
    expect(result.panels[0].body).toContain("模型缺失");
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
  it("does not overwrite a successful free result when optional AI fails", () => {
    const local = { ...getQueryResult("phase out"), status: "success" as const };
    const result = mergeAiPanels(local, [{ id: "ai-error", label: "AI 翻译", badge: "失败", title: "", body: "AI 不可用" }]);
    expect(result.status).toBe("success");
    expect(result.panels[0].id).toBe("local");
  });
});

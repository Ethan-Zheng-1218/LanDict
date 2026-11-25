import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  vi.doUnmock("../features/vocabulary/VocabularyPage");
  vi.resetModules();
});

describe("application routes", () => {
  it("renders the default home route", async () => {
    const { appRoutes } = await import("./routes");
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/"] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "查询记录" })).toBeInTheDocument();
    router.dispose();
  });

  it("renders a deferred vocabulary route after navigation", async () => {
    const { appRoutes } = await import("./routes");
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/vocabulary"] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText("生词本还是空的")).toBeInTheDocument();
    router.dispose();
  });

  it("renders query history on its own route", async () => {
    const { appRoutes } = await import("./routes");
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/records"] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "查询历史" })).toBeInTheDocument();
    expect(screen.queryByText("功能开发中，敬请期待。")).not.toBeInTheDocument();
    router.dispose();
  });

  it("initializes route configuration without waiting for a deferred page module", async () => {
    vi.doMock("../features/vocabulary/VocabularyPage", async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 400));
      return { VocabularyPage: () => <section>延迟生词本</section> };
    });

    const routeImport = import("./routes");
    const loaded = await Promise.race([
      routeImport.then(() => true),
      new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 100)),
    ]);

    try {
      expect(loaded).toBe(true);
    } finally {
      await routeImport;
    }
  });
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

/** 每个用例都拿一份全新的模块，避免模块级的词族缓存串场。 */
async function freshStore() {
  return await import("./wordFamilyStore");
}

it("builds a family from the local tables without any dev server", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no dev server")));
  const { loadWordFamilies } = await freshStore();

  const families = await loadWordFamilies(["ran", "children"]);
  expect(families.ran).toEqual(expect.arrayContaining(["ran", "run"]));
  expect(families.children).toEqual(expect.arrayContaining(["children", "child"]));
});

it("lists the irregular forms of a saved lemma, which no rule can guess backwards", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const { loadWordFamilies } = await freshStore();

  const families = await loadWordFamilies(["run", "go"]);
  expect(families.run).toEqual(expect.arrayContaining(["run", "ran"]));
  expect(families.go).toEqual(expect.arrayContaining(["go", "went"]));
});

it("uses the Oxford lemma table when the lookup api answers", async () => {
  // 牛津的变形指向表里 knives 指向 knife，本地不规则表也有，两条路互为补充。
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).startsWith("/api/dictionary-lemmas")) {
      return { ok: true, json: async () => ({ lemmas: { knives: "knife" } }) };
    }
    return { ok: false, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  const { loadWordFamilies } = await freshStore();

  const families = await loadWordFamilies(["knives"]);
  expect(families.knives).toEqual(expect.arrayContaining(["knives", "knife"]));
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/dictionary-lemmas",
    expect.objectContaining({ body: JSON.stringify({ words: ["knives"] }) }),
  );
});

it("caches the answer so the same word is never queried twice", async () => {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ lemmas: {} }) }));
  vi.stubGlobal("fetch", fetchMock);
  const { loadWordFamilies } = await freshStore();

  await loadWordFamilies(["cat"]);
  fetchMock.mockClear();
  const again = await loadWordFamilies(["cat"]);
  expect(again.cat).toEqual(expect.arrayContaining(["cat"]));
  expect(fetchMock).not.toHaveBeenCalled();
});

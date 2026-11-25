import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { saveVocabularyBackup, serializeVocabularyBackup, vocabularyBackupFileName } from "./vocabularyBackup";
import { parseVocabularyImport } from "./vocabularyImport";
import { addVocabularyEntries, listVocabulary, saveVocabulary, updateVocabulary } from "./vocabularyStore";

describe("vocabulary backup", () => {
  beforeEach(() => window.localStorage.clear());

  it("restores every saved field through the existing importer on a new computer", () => {
    const entry = saveVocabulary({
      word: "serendipity", meaning: "机缘巧合\n意外的幸运", definition: "A happy discovery.",
      phonetic: "/s/", britishPhonetic: "/gb/", americanPhonetic: "/us/", partOfSpeech: "noun",
      collocations: ["pure serendipity"], collocationTranslations: { "pure serendipity": "纯属巧合" },
      examples: [{ partOfSpeech: "noun", text: "It was serendipity.", translation: "这是机缘巧合。" }],
      example: "A happy discovery.", source: "阅读器", sourceType: "reading",
    });
    updateVocabulary(entry.id, { status: "mastered", note: '记住这个词："幸运"\n第二行' });
    const { id: _originalId, ...original } = listVocabulary()[0];
    const raw = serializeVocabularyBackup(listVocabulary(), new Date("2026-11-24T08:30:00Z"));
    expect(JSON.parse(raw)).toMatchObject({ format: "landict-vocabulary", schemaVersion: 1, exportedAt: "2026-11-24T08:30:00.000Z" });
    window.localStorage.clear();

    const parsed = parseVocabularyImport(raw);
    expect(parsed.format).toBe("backup");
    addVocabularyEntries(parsed.items.map((item) => ({ source: "导入", sourceType: "import", ...item })));

    const restored = listVocabulary()[0];
    expect(restored).toMatchObject(original);
    expect(listVocabulary()).toHaveLength(1);
  });

  it("keeps saved entries that generic word-list filtering would discard", () => {
    ["word", "a phrase with more than six individual words", "静夜思"].forEach((word) => saveVocabulary({ word, meaning: "保存的内容", source: "导入", sourceType: "import" }));
    const raw = serializeVocabularyBackup(listVocabulary());
    window.localStorage.clear();
    const parsed = parseVocabularyImport(raw);
    addVocabularyEntries(parsed.items.map((item) => ({ source: "导入", sourceType: "import", ...item })));
    expect(listVocabulary().map((entry) => entry.word)).toEqual(["静夜思", "a phrase with more than six individual words", "word"]);
  });

  it("skips duplicates without overwriting the destination's notes or learning state", () => {
    const entry = saveVocabulary({ word: "cat", meaning: "猫", source: "阅读器", sourceType: "reading" });
    updateVocabulary(entry.id, { note: "旧电脑笔记", status: "mastered" });
    const raw = serializeVocabularyBackup(listVocabulary());
    window.localStorage.clear();
    const local = saveVocabulary({ word: "cat", meaning: "本机释义", source: "导入", sourceType: "import" });
    updateVocabulary(local.id, { note: "保留本机笔记", status: "learning" });
    const parsed = parseVocabularyImport(raw, ["CAT"]);
    expect(parsed.duplicateCount).toBe(1);
    expect(parsed.items).toEqual([]);
    expect(listVocabulary()[0]).toMatchObject({ meaning: "本机释义", note: "保留本机笔记", status: "learning" });
  });

  it("rejects unsupported backup versions instead of silently importing only words and meanings", () => {
    const result = parseVocabularyImport(JSON.stringify({ format: "landict-vocabulary", schemaVersion: 99, entries: [{ word: "cat", meaning: "猫" }] }));
    expect(result.format).toBe("unsupported-backup");
    expect(result.items).toEqual([]);
  });

  it("rejects damaged backup markers and truncated JSON instead of downgrading to a word list", () => {
    saveVocabulary({ word: "cat", meaning: "猫", source: "导入", sourceType: "import" });
    const raw = serializeVocabularyBackup(listVocabulary());
    const withoutMarker = JSON.parse(raw);
    delete withoutMarker.format;
    expect(parseVocabularyImport(JSON.stringify(withoutMarker))).toMatchObject({ format: "invalid-backup", items: [] });
    expect(parseVocabularyImport(raw.replace("landict-vocabulary", "wrong-format"))).toMatchObject({ format: "invalid-backup", items: [] });
    expect(parseVocabularyImport(raw.slice(0, -1))).toMatchObject({ format: "invalid-json", items: [] });
  });

  it.each([
    { note: { invalid: "object" } }, { status: "wrong" }, { collocations: [42] },
    { examples: [{ partOfSpeech: "noun", text: 42 }] }, { createdAt: "invalid-date" },
    { collocationTranslations: { phrase: 42 } },
  ])("rejects corrupted backup metadata without partially restoring entries: %j", (patch) => {
    saveVocabulary({ word: "cat", meaning: "猫", source: "导入", sourceType: "import" });
    const backup = JSON.parse(serializeVocabularyBackup(listVocabulary()));
    Object.assign(backup.entries[0], patch);
    const result = parseVocabularyImport(JSON.stringify(backup));
    expect(result.format).toBe("invalid-backup");
    expect(result.items).toEqual([]);
  });
});

describe("vocabulary backup save dialog", () => {
  const internalsKey = "__TAURI_INTERNALS__";

  beforeEach(() => window.localStorage.clear());
  afterEach(() => { delete (window as unknown as Record<string, unknown>)[internalsKey]; });

  it("names the exported file with the local date", () => {
    expect(vocabularyBackupFileName(new Date(2026, 10, 24, 16, 30))).toBe("LanDict-生词本-2026-11-24.json");
  });

  it("passes the readable name and the JSON to the native save dialog", async () => {
    const invoke = vi.fn().mockResolvedValue("C:\\Users\\me\\Desktop\\LanDict-生词本-2026-11-24.json");
    (window as unknown as Record<string, unknown>)[internalsKey] = { invoke };
    saveVocabulary({ word: "cat", meaning: "猫", source: "导入", sourceType: "import" });

    const result = await saveVocabularyBackup(listVocabulary(), new Date(2026, 10, 24, 16, 30));

    expect(result).toEqual({
      status: "saved",
      path: "C:\\Users\\me\\Desktop\\LanDict-生词本-2026-11-24.json",
      fileName: "LanDict-生词本-2026-11-24.json",
    });
    const [command, args] = invoke.mock.calls[0];
    expect(command).toBe("export_vocabulary_backup");
    expect(args).toMatchObject({ defaultName: "LanDict-生词本-2026-11-24.json" });
    expect(JSON.parse(args.contents).entries.map((item: { word: string }) => item.word)).toEqual(["cat"]);
  });

  it("treats a closed save dialog as cancelled instead of an error", async () => {
    (window as unknown as Record<string, unknown>)[internalsKey] = { invoke: vi.fn().mockResolvedValue(null) };
    saveVocabulary({ word: "cat", meaning: "猫", source: "导入", sourceType: "import" });

    await expect(saveVocabularyBackup(listVocabulary())).resolves.toEqual({ status: "cancelled" });
  });
});

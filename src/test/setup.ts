import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

const storageData = new Map<string, string>();
const localStorageMock: Storage = {
  get length() { return storageData.size; },
  clear: () => storageData.clear(),
  getItem: (key) => storageData.get(key) ?? null,
  key: (index) => [...storageData.keys()][index] ?? null,
  removeItem: (key) => { storageData.delete(key); },
  setItem: (key, value) => { storageData.set(key, String(value)); },
};

if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", { configurable: true, value: localStorageMock });

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  if (!("speechSynthesis" in window)) {
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: { cancel: vi.fn(), speak: vi.fn() },
    });
  }
}

if (typeof globalThis.SpeechSynthesisUtterance === "undefined") {
  class SpeechSynthesisUtteranceMock {
    text: string;
    lang = "";

    constructor(text: string) {
      this.text = text;
    }
  }
  Object.assign(globalThis, { SpeechSynthesisUtterance: SpeechSynthesisUtteranceMock });
}

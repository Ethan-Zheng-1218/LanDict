export type HoverSample = { id: number; word: string; context: string; source: "uia" | "ocr" };
export type HoverSnapshot = { revision: number; sample: HoverSample | null };

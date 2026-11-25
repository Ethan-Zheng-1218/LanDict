import { dispatchStorageEvent, readStored, writeStored } from "../../lib/browserStorage";

export const LEARNING_STORAGE_KEY = "landict.learning.v1";
export const LEARNING_CHANGED_EVENT = "landict:learning-changed";

export type LearningEventType = "lookup" | "reading" | "review";
export type LearningEvent = {
  id: string;
  type: LearningEventType;
  label: string;
  createdAt: string;
};
export type NewLearningEvent = Pick<LearningEvent, "type" | "label">;

const isLearningEventType = (value: unknown): value is LearningEventType => value === "lookup" || value === "reading" || value === "review";
const isLearningEvent = (value: unknown): value is LearningEvent => {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<LearningEvent>;
  return typeof event.id === "string" && isLearningEventType(event.type)
    && typeof event.label === "string" && typeof event.createdAt === "string";
};
const isLearningEventList = (value: unknown): value is LearningEvent[] => Array.isArray(value) && value.every(isLearningEvent);

export function listLearningEvents(): LearningEvent[] {
  return readStored(LEARNING_STORAGE_KEY, [], isLearningEventList);
}

export function addLearningEvent(input: NewLearningEvent): LearningEvent {
  const label = input.label.trim();
  if (!label) throw new Error("学习记录标题不能为空");
  const event: LearningEvent = {
    id: `learning-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    type: input.type,
    label,
    createdAt: new Date().toISOString(),
  };
  writeStored(LEARNING_STORAGE_KEY, [event, ...listLearningEvents()]);
  dispatchStorageEvent(LEARNING_CHANGED_EVENT);
  return event;
}

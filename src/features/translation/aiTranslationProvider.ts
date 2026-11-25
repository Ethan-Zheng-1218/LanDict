import { loadSettings } from "../settings/settingsStore";
import { isTauri } from "@tauri-apps/api/core";
import { invokeWithAbort } from "../../lib/desktop";
import { buildAiLearningTask, isEnglishLearningWord, type AiLearningCategory } from "./aiLearning";

export type { AiLearningCategory } from "./aiLearning";

export type AiTranslationMode = "phrase" | "text" | "word";

export type AiTranslationRequest = { text: string; mode: AiTranslationMode };
export type AiTranslationResponse = { translation: string; explanation?: string };
export type AiTranslationStatus = "success" | "unconfigured" | "error";
export type AiTranslationState = {
  status: AiTranslationStatus;
  response?: AiTranslationResponse;
  message?: string;
};

export interface AiTranslationProvider {
  id: string;
  name: string;
  isConfigured(): boolean;
  translate(request: AiTranslationRequest): Promise<AiTranslationResponse>;
}

export const AI_NOT_CONFIGURED_MESSAGE =
  "尚未配置 AI 翻译接口。请在「设置 → 翻译」里填写 API Base URL、API Key 和模型名称。";

export const unconfiguredAiProvider: AiTranslationProvider = {
  id: "unconfigured",
  name: "AI 翻译接口",
  isConfigured: () => false,
  async translate() {
    throw new Error(AI_NOT_CONFIGURED_MESSAGE);
  },
};

export async function translateWithStatus(
  provider: AiTranslationProvider,
  request: AiTranslationRequest,
): Promise<AiTranslationState> {
  if (!provider.isConfigured()) {
    return { status: "unconfigured", message: AI_NOT_CONFIGURED_MESSAGE };
  }
  try {
    return { status: "success", response: await provider.translate(request) };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "AI 翻译接口暂时不可用。",
    };
  }
}

/**
 * Panel-based AI output. Every surface (home lookup, reader) asks for the cards it wants and the
 * provider only fills in title/body, so the UI keeps control over labels and badges.
 */
export type AiPanel = { id: string; label: string; badge: string; title: string; body: string };

export type AiPanelRequest = {
  text: string;
  mode: AiTranslationMode;
  /** Sentence the word appeared in, enabling the "meaning in this article" card. */
  context?: string;
  /** News copy gets a single news-register translation instead of everyday + academic variants. */
  register?: "neutral" | "news";
  /** Optional, single-English-word learning content instead of translation. */
  learning?: AiLearningCategory;
};

export type AiCardSpec = { id: string; label: string; badge: string; title: string; instruction: string };

export type AiCardSpecs = { cards: AiCardSpec[]; task: string };

export class AiRequestError extends Error {
  constructor(message: string, readonly kind: "unconfigured" | "network" | "http" | "parse" | "validation") {
    super(message);
    this.name = "AiRequestError";
  }
}

const AI_TIMEOUT_MS = 60000;
const panelCache = new Map<string, AiPanel[]>();
let panelCacheRevision = 0;

export function clearAiPanelCache() {
  panelCache.clear();
  panelCacheRevision += 1;
}

export function describeAiError(error: unknown): string {
  if (error instanceof AiRequestError) return error.message;
  if (error instanceof Error && error.message) return `AI 接口调用失败：${error.message}`;
  return "AI 接口调用失败，请稍后重试。";
}

export function isAiConfigured(): boolean {
  // Filling in an endpoint, key and model is the only switch: there is no second master toggle
  // that could silently leave a saved key unused.
  const { apiBaseUrl, apiKey, model } = loadSettings().translation;
  return Boolean(apiBaseUrl.trim() && apiKey.trim() && model.trim());
}

const SYSTEM_PROMPT = [
  "你是 LanDict 英语学习应用里的 AI 助手，服务对象是中文母语的英语学习者。",
  "只输出一个 JSON 对象，不要输出任何解释、寒暄或 markdown 代码块，格式固定为：",
  '{"cards":[{"id":"卡片 id","title":"卡片标题","body":"卡片正文"}]}',
  "label、title、body 使用简体中文；英文例句保留英文，并在需要时附上中文翻译。",
  "body 里可以用换行分隔要点，不要使用 markdown 标记（不要用 #、*、```）。",
].join("\n");

function specsFor(request: AiPanelRequest): AiCardSpecs {
  if (request.learning) {
    if (request.mode !== "word" || !isEnglishLearningWord(request.text)) {
      throw new AiRequestError("单词学习仅支持一个英文单词。请先查询目标英文单词。", "validation");
    }
    return {
      task: buildAiLearningTask(request.text, request.learning),
      cards: [{ id: `ai-learning-${request.learning}`, label: "AI 翻译", badge: "", title: "", instruction: "正文按上面的编号分段格式书写。" }],
    };
  }
  if (request.mode === "word" && /\p{Script=Han}/u.test(request.text)) {
    return {
      task: [
        `中文词语：${request.text}`,
        "请给出对应的常用英文表达，并用中文解释不同表达的用法区别。",
        "格式要求：一共三段，用空行分开。第一段以「英文表达：」开头，列出对应英文词或短语；第二段以「用法区别：」开头，说明适用语境和常见搭配；第三段以「例句：」开头，给一个英文例句，下一行给出中文翻译。",
        "不要输出汉语拼音或音标，不要使用 markdown 标记。",
      ].join("\n"),
      cards: [{ id: "ai-word", label: "AI 翻译", badge: "", title: "", instruction: "正文按上面的三段格式书写。" }],
    };
  }
  if (request.mode === "word" && request.context) {
    return {
      task: [
        `目标单词：${request.text}`,
        `它所在的句子：${request.context}`,
        "任务：说明这个单词在这句话里的意思，并给出它的常见搭配。",
        "格式要求：一共两段，用空行分开。第一段写词性与在本句中的意思；第二段以「常见搭配：」开头，列出 1-2 个搭配（英文 + 中文）。",
        "不要罗列词典里的其它义项，不要翻译整个句子，全文控制在 90 字以内。",
      ].join("\n"),
      cards: [{ id: "ai-context", label: "AI 语境义", badge: "", title: "", instruction: "正文按上面的两段格式书写。" }],
    };
  }
  if (request.mode === "word") {
    return {
      task: [
        `目标单词：${request.text}`,
        "本地词典已经给出基本释义和音标，所以只补充学习向内容。",
        "格式要求：一共三段，用空行分开。第一段以「用法：」开头，一句话说明这个词的用法与语境；第二段以「常见搭配：」开头，列 2-3 个搭配（英文 + 中文）；第三段以「例句：」开头，给一个英文例句，下一行给它的中文翻译。",
        "不要重复基本释义，不要输出音标，不要使用 markdown 标记。",
      ].join("\n"),
      cards: [{ id: "ai-word", label: "AI 翻译", badge: "", title: "", instruction: "正文按上面的三段格式书写。" }],
    };
  }
  if (/\p{Script=Han}/u.test(request.text)) {
    return {
      task: [
        `中文原文：${request.text}`,
        "请将这段中文翻译成自然、准确的英文，并符合英语母语表达习惯。",
        "只输出一个英文版本，不要解释，不要输出中文。",
      ].join("\n"),
      cards: [{ id: "ai-english", label: "AI 翻译", badge: "", title: "英文翻译", instruction: "正文只写英文译文。" }],
    };
  }
  if (request.register === "news") {
    return {
      task: [
        `文本：${request.text}`,
        "这是一篇英文新闻或文章里的内容。请把它翻译成准确、书面、新闻体的中文。",
        "只输出一个版本，不要口语化版本，不要逐词解释，不要加注释。",
      ].join("\n"),
      cards: [{ id: "ai-news", label: "AI 翻译", badge: "", title: "", instruction: "正文只写译文。" }],
    };
  }
  return {
    task: [
      `文本：${request.text}`,
      "请给出两个中文版本：第一版日常口语化、自然；第二版学术、书面、正式。",
      "不要逐词解释，两个版本都要完整翻译整段内容。",
    ].join("\n"),
    cards: [
      { id: "ai-daily", label: "AI 翻译", badge: "", title: "日常表达", instruction: "正文是口语化的中文翻译。" },
      { id: "ai-academic", label: "AI 翻译", badge: "", title: "书面表达", instruction: "正文是学术、书面化的中文翻译。" },
    ],
  };
}

function buildUserPrompt(specs: AiCardSpecs): string {
  const cards = specs.cards
    .map((card) => `- id 必须是 "${card.id}"。${card.title ? `标题写 "${card.title}"。` : "不要写标题。"}${card.instruction}`)
    .join("\n");
  return `${specs.task}\n\n请输出这些卡片：\n${cards}\n\n只输出 JSON。`;
}

function isAiPanel(value: unknown): value is Partial<AiPanel> {
  return Boolean(value) && typeof value === "object" && typeof (value as Partial<AiPanel>).id === "string";
}

export function parseAiPanels(content: string, specs: AiCardSpecs): AiPanel[] {
  const json = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = json.indexOf("{");
  const end = json.lastIndexOf("}");
  const parsed = start >= 0 && end > start ? safeJson(json.slice(start, end + 1)) : undefined;
  const rawCards = Array.isArray((parsed as { cards?: unknown } | undefined)?.cards) ? (parsed as { cards: unknown[] }).cards : [];
  const cards = rawCards.filter(isAiPanel);
  const panels = specs.cards.map((spec, index) => {
    const match = cards.find((card) => card.id === spec.id) ?? (cards.length === specs.cards.length ? cards[index] : undefined);
    const body = typeof match?.body === "string" ? match.body.trim() : "";
    const title = spec.title && typeof match?.title === "string" && match.title.trim() ? match.title.trim() : spec.title;
    return { id: spec.id, label: spec.label, badge: spec.badge, title, body };
  });
  if (panels.some((panel) => panel.body)) return panels;
  // A model that ignored the JSON contract still gets to answer in plain text.
  return [{ ...panels[0], title: specs.cards[0].title, body: content.trim() }];
}

function safeJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return undefined; }
}

function errorMessageFrom(response: Response, body: string) {
  const parsed = safeJson(body) as { error?: { message?: unknown }; message?: unknown } | undefined;
  const upstream = typeof parsed?.error?.message === "string" ? parsed.error.message : typeof parsed?.message === "string" ? parsed.message : "";
  const detail = upstream || body.trim().slice(0, 200);
  return `AI 接口返回 ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${detail ? `：${detail}` : ""}`;
}

export type AiCredentials = { apiBaseUrl: string; apiKey: string; model: string };

function isCredentialComplete(credentials: AiCredentials) {
  return Boolean(credentials.apiBaseUrl.trim() && credentials.apiKey.trim() && credentials.model.trim());
}

async function postChatCompletion(
  credentials: AiCredentials,
  messages: { role: "system" | "user"; content: string }[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string> {
  const { signal } = options;
  signal?.throwIfAborted();
  if (!isCredentialComplete(credentials)) throw new AiRequestError(AI_NOT_CONFIGURED_MESSAGE, "unconfigured");
  const baseUrl = credentials.apiBaseUrl.trim().replace(/\/+$/, "");
  const useLocalProxy = typeof window !== "undefined" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? AI_TIMEOUT_MS;
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const nativeResponse = isTauri() ? await invokeWithAbort<{ status: number; body: string }>("desktop_ai_request", {
      credentials: { ...credentials, apiBaseUrl: baseUrl }, messages, timeoutMs,
    }, controller.signal) : null;
    const response = nativeResponse ? new Response(nativeResponse.body, { status: nativeResponse.status }) : await fetch(useLocalProxy ? "/api/ai-translate" : `${baseUrl}/chat/completions`, {
      method: "POST",
      headers: useLocalProxy
        ? { "Content-Type": "application/json" }
        : { "Content-Type": "application/json", Authorization: `Bearer ${credentials.apiKey.trim()}` },
      body: JSON.stringify(useLocalProxy
        ? { baseUrl, apiKey: credentials.apiKey.trim(), model: credentials.model.trim(), messages }
        : { model: credentials.model.trim(), messages, temperature: 0.2 }),
      signal: controller.signal,
    });
    const body = await response.text();
    signal?.throwIfAborted();
    if (controller.signal.aborted) throw new Error("Request timed out");
    if (!response.ok) throw new AiRequestError(errorMessageFrom(response, body), "http");
    const data = safeJson(body) as { choices?: { message?: { content?: unknown } }[] } | undefined;
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new AiRequestError("AI 接口没有返回内容。", "parse");
    return content;
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof AiRequestError) throw error;
    if (controller.signal.aborted) throw new AiRequestError(`AI 接口请求超时（${Math.round(timeoutMs / 1000)} 秒），请稍后重试。`, "network");
    throw new AiRequestError(`AI 接口请求失败：${error instanceof Error ? error.message : "未知错误"}`, "network");
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export type AiConnectionTest = { ok: boolean; message: string; elapsedMs: number };

/** Verifies the credentials the settings form currently shows, before they are saved. */
export async function testAiConnection(credentials: AiCredentials, signal?: AbortSignal): Promise<AiConnectionTest> {
  const started = Date.now();
  try {
    await postChatCompletion(credentials, [
      { role: "system", content: "你是连接测试助手，只回复一个词。" },
      { role: "user", content: "请只回复：ok" },
    ], { signal, timeoutMs: 20000 });
    return { ok: true, message: `连接成功，${credentials.model.trim()} 已正常响应。`, elapsedMs: Date.now() - started };
  } catch (error) {
    return { ok: false, message: describeAiError(error), elapsedMs: Date.now() - started };
  }
}

export async function requestAiPanels(request: AiPanelRequest, signal?: AbortSignal): Promise<AiPanel[]> {
  signal?.throwIfAborted();
  const settings = loadSettings().translation;
  const specs = specsFor(request);
  // This key stays in memory only; include the complete credential to isolate equal-length keys.
  const cacheKey = JSON.stringify([settings.apiBaseUrl, settings.model, settings.apiKey, request.mode, request.register ?? "", request.context ?? "", request.text, request.learning ?? ""]);
  const cached = panelCache.get(cacheKey);
  if (cached) return cached;
  const revision = panelCacheRevision;
  const content = await postChatCompletion(settings, [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(specs) },
  ], { signal });
  signal?.throwIfAborted();
  const panels = parseAiPanels(content, specs);
  if (revision === panelCacheRevision) panelCache.set(cacheKey, panels);
  return panels;
}
